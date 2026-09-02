import { describe, it, expect } from "vitest";
import { SessionBuffer, primingBonus } from "../src/priming.js";

describe("SessionBuffer", () => {
  it("reports notes it has seen", () => {
    const buffer = new SessionBuffer(3);
    buffer.touch("A");
    expect(buffer.has("A")).toBe(true);
    expect(buffer.has("B")).toBe(false);
  });

  it("evicts the least-recently-touched note once past capacity", () => {
    const buffer = new SessionBuffer(2);
    buffer.touch("A");
    buffer.touch("B");
    buffer.touch("C");
    expect(buffer.has("A")).toBe(false);
    expect(buffer.entries()).toEqual(["B", "C"]);
  });

  it("re-touching a note refreshes its recency instead of duplicating it", () => {
    const buffer = new SessionBuffer(2);
    buffer.touch("A");
    buffer.touch("B");
    buffer.touch("A");
    buffer.touch("C");
    expect(buffer.has("A")).toBe(true);
    expect(buffer.has("B")).toBe(false);
    expect(buffer.entries()).toEqual(["A", "C"]);
  });

  it("records when each note was touched", () => {
    const buffer = new SessionBuffer();
    const t0 = new Date("2026-09-02T10:00:00.000Z");
    buffer.touch("A", t0);
    expect(buffer.touchedAt("A")).toBe(t0.getTime());
    expect(buffer.touchedAt("B")).toBeUndefined();
  });

  it("re-touching a note updates its touchedAt timestamp", () => {
    const buffer = new SessionBuffer();
    const t0 = new Date("2026-09-02T10:00:00.000Z");
    const t1 = new Date("2026-09-02T10:30:00.000Z");
    buffer.touch("A", t0);
    buffer.touch("A", t1);
    expect(buffer.touchedAt("A")).toBe(t1.getTime());
  });
});

describe("primingBonus", () => {
  it("returns the configured bonus for a note touched at the reference instant", () => {
    const buffer = new SessionBuffer();
    const now = new Date("2026-09-02T10:00:00.000Z");
    buffer.touch("A", now);
    expect(primingBonus("A", buffer, { bufferSize: 20, bonus: 3, halfLifeMinutes: 20 }, now)).toBe(3);
  });

  it("returns zero for a note not in the buffer", () => {
    const buffer = new SessionBuffer();
    expect(primingBonus("A", buffer)).toBe(0);
  });

  // AIBRAIN-141: buffer membership used to be a binary switch — the flat
  // bonus applied in full the instant a note was touched and stayed at
  // full strength, regardless of how long ago that was, right up until
  // LRU eviction. It now decays with time since the touch.
  it("decays to roughly half the bonus after one half-life", () => {
    const buffer = new SessionBuffer();
    const t0 = new Date("2026-09-02T10:00:00.000Z");
    buffer.touch("A", t0);
    const config = { bufferSize: 20, bonus: 4, halfLifeMinutes: 20 };
    const oneHalfLifeLater = new Date(t0.getTime() + 20 * 60 * 1000);
    expect(primingBonus("A", buffer, config, oneHalfLifeLater)).toBeCloseTo(2, 5);
  });

  it("decays to near-zero several half-lives after the touch", () => {
    const buffer = new SessionBuffer();
    const t0 = new Date("2026-09-02T10:00:00.000Z");
    buffer.touch("A", t0);
    const config = { bufferSize: 20, bonus: 4, halfLifeMinutes: 20 };
    const fiveHalfLivesLater = new Date(t0.getTime() + 5 * 20 * 60 * 1000);
    expect(primingBonus("A", buffer, config, fiveHalfLivesLater)).toBeLessThan(config.bonus * 0.05);
  });

  it("re-touching resets the decay clock", () => {
    const buffer = new SessionBuffer();
    const t0 = new Date("2026-09-02T10:00:00.000Z");
    const t1 = new Date("2026-09-02T10:19:00.000Z"); // just under one half-life after t0
    buffer.touch("A", t0);
    buffer.touch("A", t1); // re-touch: decay clock should restart from t1
    const config = { bufferSize: 20, bonus: 4, halfLifeMinutes: 20 };
    expect(primingBonus("A", buffer, config, t1)).toBeCloseTo(4, 5);
  });
});
