import "server-only";

import { Worker } from "node:worker_threads";
import type { PluginDecision } from "./plugin-runtime";

/**
 * Runtime isolation for strategy plugins.
 *
 * Plugin source never runs in the host process. Each execution spins a
 * throwaway `worker_threads` Worker whose script evaluates the plugin inside
 * a bare `node:vm` context. The context is built from a single `{ input }`
 * binding, so by construction there is:
 *
 * - no `require`, `process`, `Buffer`, `fetch`, or host globals — the realm
 *   has only the ECMAScript intrinsics (verified against both the bun and
 *   node runtimes; see the adversarial tests in
 *   test/ai/capital-engine/plugin-runtime.test.ts);
 * - no code generation: `codeGeneration: { strings: false, wasm: false }`
 *   makes `eval` and `new Function` throw inside the realm, which also kills
 *   the `Function`-constructor escape to host globals;
 * - no module resolution: the realm cannot reach the host's `require` or
 *   dynamic `import`, so broker/credential/ledger/db modules are unreachable
 *   by construction — not merely rejected by pattern;
 * - a hard wall-clock budget: sync work is bounded by the vm timeout, async
 *   work by `worker.terminate()` at the deadline, so a plugin cannot hang
 *   the pipeline — plus a heap cap (`resourceLimits`) so it cannot
 *   memory-DoS the host either. Callers may tune the per-run budget/heap
 *   via `budgetMs`/`heapLimitMb`, but only within hard ceilings
 *   (MAX_PLUGIN_EXECUTION_BUDGET_MS / MAX_PLUGIN_HEAP_MB) — beyond them
 *   the run is refused, because the budget is a security parameter;
 * - cancellation: an AbortSignal terminates the worker immediately, so a
 *   supervisor can revoke an in-flight run instead of waiting out its
 *   budget;
 * - input/output size caps: payloads crossing the boundary are
 *   JSON-serialized and size-limited before the host ever sees them.
 *
 * Decision validation (evidence identity checks) is deliberately host-side:
 * it inspects host-produced data and executes no plugin code, so the worker
 * exists only for untrusted source execution. One request, one response,
 * then the worker dies — nothing a plugin does outlives its own worker.
 */

/** Hard wall-clock budget for a full plugin run, including worker spin-up. */
export const PLUGIN_EXECUTION_BUDGET_MS = 5_000;

/**
 * Ceiling for caller-requested budgets: a run may ask for a longer or
 * shorter budget than the default, but never beyond this bound — the
 * wall clock is a security property, so "configurable" cannot mean
 * "unlimited". Requesting more is refused (not silently clamped):
 * silently granting less than asked would hide misconfiguration.
 */
export const MAX_PLUGIN_EXECUTION_BUDGET_MS = 30_000;

/** Default heap cap; callers may raise it up to MAX_PLUGIN_HEAP_MB. */
export const PLUGIN_HEAP_LIMIT_MB = 128;
export const MAX_PLUGIN_HEAP_MB = 512;

/** Sync-code ceiling inside the vm realm (vm timeout for runInContext). */
const VM_SYNC_TIMEOUT_MS = PLUGIN_EXECUTION_BUDGET_MS;

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 32 * 1024;
const MAX_INPUT_BYTES = 128 * 1024;

export interface IsolatedPluginSourceInput {
  /**
   * Wall-clock budget for THIS run in ms. Optional; defaults to
   * PLUGIN_EXECUTION_BUDGET_MS. Must be a positive finite number and no
   * more than MAX_PLUGIN_EXECUTION_BUDGET_MS.
   */
  budgetMs?: number;
  /** Heap cap for the isolated worker in MB (ceiling MAX_PLUGIN_HEAP_MB). */
  heapLimitMb?: number;
  input: Record<string, unknown>;
  /**
   * Cancellation: aborting the signal terminates the worker immediately
   * (the run settles as cancelled, before its budget expires). An
   * already-aborted signal refuses the run without spawning a worker.
   */
  signal?: AbortSignal;
  source: string;
}

type RunSourceRequest = {
  input: Record<string, unknown>;
  source: string;
  syncTimeoutMs: number;
  type: "run_source";
};

type WorkerResponse =
  | { ok: true; decision: unknown }
  | { ok: false; error: string };

const WORKER_SOURCE = `
  const { parentPort } = require("node:worker_threads");
  const vm = require("node:vm");

  const deny = (error) => parentPort.postMessage({ ok: false, error });

  parentPort.on("message", async (request) => {
    try {
      if (request.type !== "run_source") return deny("unknown plugin boundary request");

      // Bare realm: the ONLY host binding the plugin sees is "input".
      const context = vm.createContext(
        { input: request.input },
        { codeGeneration: { strings: false, wasm: false } },
      );
      const fn = vm.runInContext("(" + request.source + ")", context, {
        timeout: request.syncTimeoutMs,
        displayErrors: true,
      });
      if (typeof fn !== "function") {
        return deny("plugin source must evaluate to a function");
      }
      // Awaited host-side: a rejected promise (e.g. a dynamic import attempt,
      // impossible because the realm has no import machinery) surfaces as a
      // plain failure instead of a resolution.
      const decision = await fn(request.input);
      parentPort.postMessage({ ok: true, decision });
    } catch (error) {
      deny(
        error instanceof Error
          ? "isolated plugin execution failed: " + error.message
          : "isolated plugin execution failed",
      );
    }
  });
`;

function assertWithinLimit(
  name: string,
  value: string,
  maxBytes: number,
): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`${name} exceeds the ${maxBytes} byte isolation limit`);
  }
}

/**
 * Validate caller-requested budgets against the hard ceilings. Throws on
 * anything that is not a positive finite number within bounds — a budget
 * is a security parameter, so bad values surface loudly instead of being
 * coerced.
 */
function resolveBudgets(
  budgetMs: number | undefined,
  heapLimitMb: number | undefined,
): { budgetMs: number; heapLimitMb: number } {
  const resolvedBudget = budgetMs ?? PLUGIN_EXECUTION_BUDGET_MS;
  if (
    !Number.isFinite(resolvedBudget) ||
    resolvedBudget <= 0 ||
    resolvedBudget > MAX_PLUGIN_EXECUTION_BUDGET_MS
  ) {
    throw new Error(
      `plugin execution budget must be between 1 and ${MAX_PLUGIN_EXECUTION_BUDGET_MS}ms (got ${String(budgetMs)})`,
    );
  }
  const resolvedHeap = heapLimitMb ?? PLUGIN_HEAP_LIMIT_MB;
  if (
    !Number.isInteger(resolvedHeap) ||
    resolvedHeap <= 0 ||
    resolvedHeap > MAX_PLUGIN_HEAP_MB
  ) {
    throw new Error(
      `plugin heap limit must be between 1 and ${MAX_PLUGIN_HEAP_MB}MB (got ${String(heapLimitMb)})`,
    );
  }
  return { budgetMs: resolvedBudget, heapLimitMb: resolvedHeap };
}

/**
 * Evaluate plugin source in a fresh, capability-less worker realm. Throws
 * (never returns a decision) when the plugin attempts anything beyond pure
 * computation on its input: forbidden modules, code generation, budgets.
 * The run settles early with a cancellation error when `signal` aborts.
 */
export async function runPluginSourceInIsolatedWorker(
  input: IsolatedPluginSourceInput,
): Promise<PluginDecision> {
  const { budgetMs, heapLimitMb } = resolveBudgets(
    input.budgetMs,
    input.heapLimitMb,
  );
  if (input.signal?.aborted) {
    throw new Error("plugin execution was cancelled before it started");
  }

  const sourceJson = JSON.stringify(input.source);
  if (sourceJson === undefined) {
    throw new Error("plugin source must be a string");
  }
  assertWithinLimit("plugin source", input.source, MAX_SOURCE_BYTES);

  const inputJson = JSON.stringify(input.input);
  if (inputJson === undefined) {
    throw new Error("plugin input must be JSON-serializable");
  }
  assertWithinLimit("plugin input", inputJson, MAX_INPUT_BYTES);

  const request: RunSourceRequest = {
    input: JSON.parse(inputJson),
    source: JSON.parse(sourceJson),
    syncTimeoutMs: Math.min(budgetMs, VM_SYNC_TIMEOUT_MS),
    type: "run_source",
  };

  const response = await executeInWorker(request, {
    budgetMs,
    heapLimitMb,
    signal: input.signal,
  });
  return validateResultSize(response);
}

function executeInWorker(
  request: RunSourceRequest,
  options: {
    budgetMs: number;
    heapLimitMb: number;
    signal?: AbortSignal;
  },
): Promise<WorkerResponse> {
  return new Promise<WorkerResponse>((resolve, reject) => {
    // Heap cap (caller-tunable up to the hard ceiling): a plugin cannot
    // memory-DoS the host even inside its own worker.
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: options.heapLimitMb,
      },
    });
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
      void worker.terminate();
      fn();
    };

    // Cancellation: terminate the worker the moment the caller aborts —
    // this is what lets a workflow shut down (or a supervisor revoke a
    // run) without waiting out the full wall-clock budget.
    const onAbort = () => {
      finish(() => {
        const reason = options.signal?.reason;
        reject(
          reason instanceof Error
            ? reason
            : new Error("plugin execution was cancelled"),
        );
      });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    // Hard wall-clock budget: a hanging async plugin is killed at the
    // deadline; a runaway sync loop trips the vm timeout inside the realm.
    const deadline = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `plugin execution exceeded the ${options.budgetMs}ms isolation budget and was terminated`,
          ),
        ),
      );
    }, options.budgetMs);

    worker.once("message", (message: WorkerResponse) => {
      finish(() => resolve(message));
    });
    worker.once("error", (error) => {
      finish(() => reject(error));
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        finish(() =>
          reject(new Error(`isolated plugin worker exited with code ${code}`)),
        );
      }
    });

    worker.postMessage(request);
  });
}

function validateResultSize(response: WorkerResponse): PluginDecision {
  if (!response.ok) {
    throw new Error(response.error);
  }
  const resultJson = JSON.stringify(response.decision);
  if (resultJson === undefined) {
    throw new Error("plugin result must be JSON-serializable");
  }
  if (Buffer.byteLength(resultJson, "utf8") > MAX_RESULT_BYTES) {
    throw new Error("plugin result exceeds the isolation size limit");
  }
  return response.decision as PluginDecision;
}
