import { describe, it, expect } from "vitest";
import { decayWeight, resolveHalfLifeDays } from "../src/decay.js";

describe("decayWeight", () => {
  it("halves the weight after one half-life period", () => {
    expect(decayWeight(10, 30, { halfLifeDays: 30 })).toBeCloseTo(5, 5);
  });

  it("quarters the weight after two half-lives", () => {
    expect(decayWeight(8, 60, { halfLifeDays: 30 })).toBeCloseTo(2, 5);
  });

  it("leaves weight unchanged at zero days elapsed", () => {
    expect(decayWeight(10, 0)).toBe(10);
  });

  it("uses the default 30-day half-life when no config is given", () => {
    expect(decayWeight(10, 30)).toBeCloseTo(5, 5);
  });
});

describe("resolveHalfLifeDays", () => {
  it("returns the per-type half-life when the note type is configured", () => {
    expect(resolveHalfLifeDays("moc", { defaultHalfLifeDays: 30, byType: { moc: 90 } })).toBe(90);
  });

  it("falls back to the default half-life for an unconfigured type", () => {
    expect(resolveHalfLifeDays("unknown-type", { defaultHalfLifeDays: 30, byType: { moc: 90 } })).toBe(30);
  });

  it("falls back to the default half-life when no note type is given", () => {
    expect(resolveHalfLifeDays(undefined, { defaultHalfLifeDays: 30, byType: { moc: 90 } })).toBe(30);
  });

  it("uses DEFAULT_NOTE_TYPE_DECAY_CONFIG when no config is given", () => {
    expect(resolveHalfLifeDays("moc")).toBe(90);
    expect(resolveHalfLifeDays("nonexistent-type")).toBe(30);
  });
});
