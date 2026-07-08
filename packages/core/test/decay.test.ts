import { describe, it, expect } from "vitest";
import { decayWeight } from "../src/decay.js";

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
