import { describe, it, expect } from "vitest";
import { MODES, MODE_RULES, isMode, canStartWithItems, startItemsMessage } from "./modes";
import { tierForAverage } from "./tiers";

describe("modes", () => {
  it("has rules for every mode", () => {
    for (const mode of MODES) {
      const rules = MODE_RULES[mode];
      expect(rules.minItems, mode).toBeLessThanOrEqual(rules.maxItems);
      expect(rules.minPlayersToStart, mode).toBeLessThanOrEqual(rules.minPlayersToReveal);
    }
  });

  it("recognizes modes", () => {
    expect(isMode("tier")).toBe(true);
    expect(isMode("poll")).toBe(false);
    expect(isMode(undefined)).toBe(false);
  });

  it("checks start item counts against the mode's range", () => {
    expect(canStartWithItems("rank", 5)).toBe(true);
    expect(canStartWithItems("rank", 4)).toBe(false);
    expect(canStartWithItems("bracket", 16)).toBe(true);
    expect(canStartWithItems("bracket", 17)).toBe(false);
  });

  it("words the start message for exact and ranged counts", () => {
    expect(startItemsMessage("rank")).toBe("Blind rank rooms need exactly 5 items to start");
    expect(startItemsMessage("mlt")).toBe(
      "Most Likely To rooms need between 3 and 15 prompts to start"
    );
  });
});

describe("tierForAverage", () => {
  it("rounds to the nearest tier and clamps to S..D", () => {
    expect(tierForAverage(5)).toBe("S");
    expect(tierForAverage(4.4)).toBe("A");
    expect(tierForAverage(3.5)).toBe("A");
    expect(tierForAverage(1)).toBe("D");
    expect(tierForAverage(0.2)).toBe("D");
  });
});
