import { describe, it, expect } from "vitest";
import { splitEntries, appendEntries, planImport, describeSkipped } from "./saved-lists";

describe("splitEntries", () => {
  it("splits pasted text into trimmed lines and drops blanks", () => {
    expect(splitEntries("  Tacos \r\n\nSushi\n   \nPizza  ")).toEqual(["Tacos", "Sushi", "Pizza"]);
  });

  it("treats a single line as one entry", () => {
    expect(splitEntries("Ramen")).toEqual(["Ramen"]);
  });
});

describe("appendEntries", () => {
  it("appends new entries and skips case-insensitive duplicates", () => {
    const res = appendEntries(["Tacos"], ["tacos", "Sushi", "SUSHI"]);
    expect(res.items).toEqual(["Tacos", "Sushi"]);
    expect(res.duplicates).toBe(2);
    expect(res.overflow).toBe(0);
  });

  it("stops at the cap and counts the rest as overflow", () => {
    const res = appendEntries(["a"], ["b", "c", "d"], 2);
    expect(res.items).toEqual(["a", "b"]);
    expect(res.overflow).toBe(2);
  });

  it("truncates over-long entries instead of dropping them", () => {
    const res = appendEntries([], ["x".repeat(150)]);
    expect(res.items[0]).toHaveLength(100);
  });
});

describe("planImport", () => {
  it("adds only what fits and isn't already in the room", () => {
    const res = planImport(["A", "b", "C", "D", "E"], ["B"], 4);
    expect(res.toAdd).toEqual(["A", "C", "D"]);
    expect(res.duplicates).toBe(1);
    expect(res.overflow).toBe(1);
  });

  it("respects a shorter per-item limit", () => {
    const res = planImport(["y".repeat(90)], [], 15, 80);
    expect(res.toAdd[0]).toHaveLength(80);
  });

  it("adds nothing to a full room", () => {
    const res = planImport(["A"], ["X", "Y"], 2);
    expect(res.toAdd).toEqual([]);
    expect(res.overflow).toBe(1);
  });
});

describe("describeSkipped", () => {
  it("is null when nothing was skipped", () => {
    expect(describeSkipped(0, 0, 15)).toBeNull();
  });

  it("names both reasons", () => {
    expect(describeSkipped(1, 3, 12)).toBe(
      "Skipped 1 already in the room and 3 over the 12-item limit."
    );
  });
});
