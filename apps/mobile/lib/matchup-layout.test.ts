import { describe, it, expect } from "vitest";
import { matchupLayout, STACK_BREAKPOINT } from "./matchup-layout";

describe("matchupLayout", () => {
  it("stacks on a phone and gives each card the full column width", () => {
    const { stacked, card } = matchupLayout(390, 844, 47);
    expect(stacked).toBe(true);
    expect(card.width).toBe(390 - 48);
    expect(card.height).toBeGreaterThan(200);
  });

  it("sits side by side on a wide window", () => {
    const { stacked, card } = matchupLayout(1280, 800, 0);
    expect(stacked).toBe(false);
    expect(card.width).toBeLessThan((1280 - 48) / 2);
    expect(card.width).toBeGreaterThan(500);
  });

  it("switches arrangement at the breakpoint", () => {
    expect(matchupLayout(STACK_BREAKPOINT - 1, 800, 0).stacked).toBe(true);
    expect(matchupLayout(STACK_BREAKPOINT, 800, 0).stacked).toBe(false);
  });

  it("stays positive on a very small window", () => {
    const { card } = matchupLayout(240, 320, 40);
    expect(card.width).toBeGreaterThan(0);
    expect(card.height).toBeGreaterThan(0);
  });

  it("gives a stacked card less height than a side-by-side one", () => {
    const tall = matchupLayout(390, 844, 0).card.height;
    const wide = matchupLayout(900, 844, 0).card.height;
    expect(tall).toBeLessThan(wide);
  });
});
