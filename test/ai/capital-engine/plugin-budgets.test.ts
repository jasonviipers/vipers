import { describe, expect, it } from "bun:test";

import {
  MAX_PLUGIN_EXECUTION_BUDGET_MS,
  MAX_PLUGIN_HEAP_MB,
  runPluginSourceInIsolatedWorker,
} from "@/ai/capital-engine/plugin-worker";

const benignSource = "async (input) => ({ ok: input.value > 0 })";

/**
 * Resource/time budgets and cancellation for isolated plugin execution.
 *
 * The worker already had a hard wall clock + heap cap; these tests pin
 * the NEW properties: caller-tunable budgets bounded by hard ceilings,
 * pre-aborted refusal, and mid-run cancellation that settles well before
 * the budget expires (the worker is terminated, not left to run out the
 * clock).
 */
describe("plugin execution budgets and cancellation", () => {
  it("runs a benign plugin under an explicit smaller budget", async () => {
    // Raw worker passthrough (no decision-schema validation at this
    // layer), so view the result loosely.
    const decision = (await runPluginSourceInIsolatedWorker({
      budgetMs: 2_000,
      input: { value: 1 },
      source: benignSource,
    })) as unknown as { ok: boolean };
    expect(decision).toEqual({ ok: true });
  });

  it("refuses budget requests beyond the hard ceiling", async () => {
    await expect(
      runPluginSourceInIsolatedWorker({
        budgetMs: MAX_PLUGIN_EXECUTION_BUDGET_MS + 1,
        input: { value: 1 },
        source: benignSource,
      }),
    ).rejects.toThrow("plugin execution budget must be between");
  });

  it("refuses non-finite, zero, and negative budgets", async () => {
    for (const budgetMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        runPluginSourceInIsolatedWorker({
          budgetMs,
          input: { value: 1 },
          source: benignSource,
        }),
      ).rejects.toThrow("plugin execution budget must be between");
    }
  });

  it("refuses heap caps beyond the hard ceiling and non-integers", async () => {
    await expect(
      runPluginSourceInIsolatedWorker({
        heapLimitMb: MAX_PLUGIN_HEAP_MB + 1,
        input: { value: 1 },
        source: benignSource,
      }),
    ).rejects.toThrow("plugin heap limit must be between");
    await expect(
      runPluginSourceInIsolatedWorker({
        heapLimitMb: 12.5,
        input: { value: 1 },
        source: benignSource,
      }),
    ).rejects.toThrow("plugin heap limit must be between");
  });

  it("refuses to start when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runPluginSourceInIsolatedWorker({
        input: { value: 1 },
        signal: controller.signal,
        source: benignSource,
      }),
    ).rejects.toThrow("cancelled before it started");
  });

  it("cancels a mid-run plugin promptly — well before its budget expires", async () => {
    const controller = new AbortController();
    // A plugin that blocks far longer than the cancel point but well
    // within the default budget.
    const hung = runPluginSourceInIsolatedWorker({
      budgetMs: 10_000,
      input: {},
      signal: controller.signal,
      source: "async () => new Promise(() => {})", // never settles
    });

    setTimeout(() => controller.abort(new Error("operator revoked run")), 250);
    const startedAt = Date.now();

    await expect(hung).rejects.toThrow("operator revoked run");
    const elapsed = Date.now() - startedAt;
    // Cancelled at ~250ms, NOT at the 10s budget: termination is the
    // point of cancellation.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("cancellation with a default reason yields the conventional AbortError", async () => {
    const controller = new AbortController();
    const hung = runPluginSourceInIsolatedWorker({
      input: {},
      signal: controller.signal,
      source: "async () => new Promise(() => {})",
    });
    setTimeout(() => controller.abort(), 250);
    // abort() with no reason produces the conventional DOMException
    // ("The operation was aborted.", name AbortError); it propagates as
    // the rejection reason.
    await expect(hung).rejects.toThrow(/abort/i);
  });
});
