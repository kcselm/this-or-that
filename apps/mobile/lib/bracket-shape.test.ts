import { describe, it, expect } from "vitest";
import { planRound } from "./bracket-shape";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);

describe("planRound", () => {
  it("pairs an even field with no bye", () => {
    expect(planRound(ids(4), 1)).toEqual([
      { slot: 0, itemA: "i0", itemB: "i1" },
      { slot: 1, itemA: "i2", itemB: "i3" },
    ]);
  });

  it("puts the bye in the last slot in odd-numbered rounds", () => {
    expect(planRound(ids(5), 1)).toEqual([
      { slot: 0, itemA: "i0", itemB: "i1" },
      { slot: 1, itemA: "i2", itemB: "i3" },
      { slot: 2, itemA: "i4", itemB: null },
    ]);
  });

  it("puts the bye in the first slot in even-numbered rounds", () => {
    expect(planRound(ids(5), 2)).toEqual([
      { slot: 0, itemA: "i0", itemB: null },
      { slot: 1, itemA: "i1", itemB: "i2" },
      { slot: 2, itemA: "i3", itemB: "i4" },
    ]);
  });

  it("plans a lone finalist as no matchups at all", () => {
    expect(planRound(ids(1), 4)).toEqual([]);
  });
});
