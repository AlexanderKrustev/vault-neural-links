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
});

describe("primingBonus", () => {
  it("returns the configured bonus for a note in the buffer", () => {
    const buffer = new SessionBuffer();
    buffer.touch("A");
    expect(primingBonus("A", buffer, { bufferSize: 20, bonus: 3 })).toBe(3);
  });

  it("returns zero for a note not in the buffer", () => {
    const buffer = new SessionBuffer();
    expect(primingBonus("A", buffer)).toBe(0);
  });
});
