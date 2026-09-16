import { Worker } from "node:worker_threads";

import type { StrategyPluginManifest } from "./plugin";
import type { PluginDecision, StrategyEvidenceInput } from "./plugin-runtime";

const WORKER_SOURCE = `
  const { parentPort } = require("node:worker_threads");
  const FORBIDDEN = ["broker", "credential", "ledger", "database", "db", "net", "http", "https", "fs"];
  const ALLOWED_PLUGIN_IDS = new Set(["consensus-v1"]);
  const deny = (message) => parentPort.postMessage({ ok: false, error: message });
  parentPort.on("message", async (request) => {
    if (request.type === "import_attempt") {
      const specifier = String(request.specifier || "").toLowerCase();
      if (FORBIDDEN.some((part) => specifier.includes(part))) {
        return deny("isolated plugin denied forbidden module import");
      }
      return deny("isolated plugin imports are not available through this boundary");
    }
    if (request.type === "run_source") {
      if (!ALLOWED_PLUGIN_IDS.has(request.pluginId)) return deny("plugin is not registered in the isolated worker");
      try {
        const vm = require("node:vm");
        const context = vm.createContext({ input: request.input });
        const fn = vm.runInContext("(" + request.source + ")", context, {
          contextCodeGeneration: { strings: false, wasm: false },
        });
        if (typeof fn !== "function") return deny("plugin source must evaluate to a function");
        const decision = await fn(request.input);
        return parentPort.postMessage({ ok: true, decision });
      } catch (error) {
        return deny(error instanceof Error ? error.message : "isolated plugin execution failed");
      }
    }
    if (request.type !== "validate") return deny("unknown plugin boundary request");
    if (!ALLOWED_PLUGIN_IDS.has(request.pluginId)) return deny("plugin is not registered in the isolated worker");
    const decision = request.decision;
    if (!decision || typeof decision !== "object") return deny("plugin decision must be an object");
    if (decision.strategyVersion !== request.manifest.pluginVersion) return deny("plugin version mismatch");
    if (decision.asset !== request.evidence.asset || decision.signalId !== request.evidence.signalId) return deny("plugin evidence identity mismatch");
    return parentPort.postMessage({ ok: true, decision });
  });
`;

export interface IsolatedPluginSourceInput {
  evidence: StrategyEvidenceInput;
  input: Record<string, unknown>;
  manifest: StrategyPluginManifest;
  pluginId: string;
  source: string;
}

export interface IsolatedPluginValidationInput {
  decision: PluginDecision;
  evidence: StrategyEvidenceInput;
  manifest: StrategyPluginManifest;
  pluginId: string;
}

export async function runPluginSourceInIsolatedWorker(
  input: IsolatedPluginSourceInput,
): Promise<PluginDecision> {
  return runWorkerRequest({ type: "run_source", ...input });
}

export async function validateInIsolatedWorker(
  input: IsolatedPluginValidationInput,
): Promise<PluginDecision> {
  return runWorkerRequest({ type: "validate", ...input });
}

async function runWorkerRequest(
  input: Record<string, unknown>,
): Promise<PluginDecision> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true });
    const cleanup = () => {
      worker.removeAllListeners();
      void worker.terminate();
    };
    worker.once(
      "message",
      (message: { ok: boolean; decision?: PluginDecision; error?: string }) => {
        cleanup();
        if (!message.ok || !message.decision) {
          reject(
            new Error(message.error ?? "isolated plugin validation failed"),
          );
          return;
        }
        resolve(message.decision);
      },
    );
    worker.once("error", (error) => {
      cleanup();
      reject(error);
    });
    worker.postMessage(input);
  });
}

export async function assertIsolatedImportDenied(
  specifier: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true });
    const cleanup = () => {
      worker.removeAllListeners();
      void worker.terminate();
    };
    worker.once("message", (message: { ok: boolean; error?: string }) => {
      cleanup();
      if (message.ok || !message.error?.includes("denied")) {
        reject(new Error("isolated worker failed to deny forbidden import"));
        return;
      }
      resolve();
    });
    worker.once("error", (error) => {
      cleanup();
      reject(error);
    });
    worker.postMessage({ specifier, type: "import_attempt" });
  });
}
