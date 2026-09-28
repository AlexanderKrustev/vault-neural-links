import { afterEach, describe, expect, it, vi } from "vitest";
import type { NightlyRunResult } from "@vault-neural-links/core";
import { EmbeddingRefresher } from "../src/embeddingRefresher.js";

/**
 * VNL-071. The refresher's job is timing and honesty: re-embed after writes
 * without piling up runs, and say once — not silently, not repeatedly — when
 * it cannot.
 */
function counting(result: Partial<NightlyRunResult> = { embeddedNoteCount: 1, reembeddedCount: 1 }) {
  return { refresh: vi.fn(async () => result) };
}

describe("EmbeddingRefresher (VNL-071)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses a burst of writes into one refresh after the quiet period", async () => {
    vi.useFakeTimers();
    const { refresh } = counting();
    const refresher = new EmbeddingRefresher("v", "d", { debounceMs: 1000, refresh, log: () => {} });

    refresher.scheduleSoon();
    await vi.advanceTimersByTimeAsync(500);
    refresher.scheduleSoon();
    refresher.scheduleSoon();
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never runs two refreshes at once; a request mid-run becomes one follow-up", async () => {
    let finishFirst!: () => void;
    let running = 0;
    let maxRunning = 0;
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls++;
      running++;
      maxRunning = Math.max(maxRunning, running);
      if (calls === 1) await new Promise<void>((resolve) => (finishFirst = resolve));
      running--;
      return {};
    });
    const refresher = new EmbeddingRefresher("v", "d", { refresh, log: () => {} });

    const first = refresher.runNow();
    void refresher.runNow();
    void refresher.runNow();
    finishFirst();
    await first;

    expect(maxRunning).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reports an unavailable model once per process, not after every write", async () => {
    const log = vi.fn();
    const refresher = new EmbeddingRefresher("v", "d", {
      refresh: async () => ({ embeddingSkipped: "model-unavailable" }),
      log,
    });

    await refresher.runNow();
    await refresher.runNow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("model-unavailable");
  });

  it("stays quiet for a vault that never opted in", async () => {
    const log = vi.fn();
    const refresher = new EmbeddingRefresher("v", "d", { refresh: async () => ({ embeddingSkipped: "not-enabled" }), log });

    await refresher.runNow();

    expect(log).not.toHaveBeenCalled();
  });

  it("survives a refresh that throws", async () => {
    const log = vi.fn();
    const refresher = new EmbeddingRefresher("v", "d", {
      refresh: async () => {
        throw new Error("disk full");
      },
      log,
    });

    await expect(refresher.runNow()).resolves.toBeUndefined();
    expect(log.mock.calls[0][0]).toContain("failed");
  });

  it("does nothing once closed", async () => {
    vi.useFakeTimers();
    const { refresh } = counting();
    const refresher = new EmbeddingRefresher("v", "d", { debounceMs: 10, refresh, log: () => {} });

    refresher.scheduleSoon();
    refresher.close();
    await vi.advanceTimersByTimeAsync(100);
    await refresher.runNow();

    expect(refresh).not.toHaveBeenCalled();
  });
});
