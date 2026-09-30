import { describe, it, expect } from "vitest";
import { layoutBracket, type BracketLayout, type BracketLine } from "./bracket-layout";
import { planRound } from "@tot/shared";
import type { BracketRound, BracketMatchup } from "./api";

// --- fixtures ----------------------------------------------------------------

const item = (id: string) => ({ id, title: id });

function matchup(
  round: number,
  slot: number,
  a: string,
  b: string | null,
  opts: { winner?: string; tiebreak?: boolean } = {}
): BracketMatchup {
  return {
    id: `r${round}s${slot}`,
    slot,
    itemA: item(a),
    itemB: b === null ? null : item(b),
    winner: opts.winner ? item(opts.winner) : b === null ? item(a) : null,
    isBye: b === null,
    decidedByTiebreak: !!opts.tiebreak,
  };
}

/**
 * Simulate a rolling-bye bracket of `n` items where itemA always wins.
 * Returns the first `roundsToInclude` rounds; the last included round is
 * left undecided when `lastRoundPending` is true.
 */
function simulate(n: number, roundsToInclude: number, lastRoundPending = false): BracketRound[] {
  let competitors = Array.from({ length: n }, (_, i) => `I${i + 1}`);
  const rounds: BracketRound[] = [];
  for (let round = 1; round <= roundsToInclude; round++) {
    const plan = planRound(competitors, round);
    if (plan.length === 0) break;
    const pending = lastRoundPending && round === roundsToInclude;
    const matchups = plan.map((p) =>
      pending && p.itemB !== null
        ? { ...matchup(round, p.slot, p.itemA, p.itemB), winner: null }
        : matchup(round, p.slot, p.itemA, p.itemB, { winner: p.itemA })
    );
    rounds.push({ round, matchups });
    competitors = plan.map((p) => p.itemA);
  }
  return rounds;
}

const ruleY = (line: BracketLine) => line.y + line.height;
const linesOfRound = (layout: BracketLayout, round: number) =>
  layout.lines.filter((l) => l.round === round);
const lineFor = (layout: BracketLayout, round: number, title: string) => {
  const line = layout.lines.find((l) => l.round === round && l.title === title);
  if (!line) throw new Error(`no line for ${title} in round ${round}`);
  return line;
};

// --- tests -------------------------------------------------------------------

describe("layoutBracket (linear)", () => {
  const fourItems = simulate(4, 2);

  it("lays out one column per round plus a winner column", () => {
    const layout = layoutBracket({ rounds: fourItems, width: 360, mode: "linear" });
    expect(layout.mode).toBe("linear");
    expect(layout.columns.map((c) => c.label)).toEqual(["ROUND 1", "FINAL", "WINNER"]);
    expect(linesOfRound(layout, 1)).toHaveLength(4);
    expect(linesOfRound(layout, 2)).toHaveLength(2);
    const champion = linesOfRound(layout, 3);
    expect(champion).toHaveLength(1);
    expect(champion[0].title).toBe("I1");
    expect(champion[0].state).toBe("champion");
  });

  it("places each advancing line at the midpoint of the pair it came from", () => {
    const layout = layoutBracket({ rounds: fourItems, width: 360, mode: "linear" });
    const i1 = lineFor(layout, 1, "I1");
    const i2 = lineFor(layout, 1, "I2");
    const advanced = lineFor(layout, 2, "I1");
    expect(ruleY(advanced)).toBeCloseTo((ruleY(i1) + ruleY(i2)) / 2);

    const champion = lineFor(layout, 3, "I1");
    const finalistA = lineFor(layout, 2, "I1");
    const finalistB = lineFor(layout, 2, "I3");
    expect(ruleY(champion)).toBeCloseTo((ruleY(finalistA) + ruleY(finalistB)) / 2);
  });

  it("carries a bye straight across at the same height", () => {
    const rounds = simulate(5, 2, true);
    const layout = layoutBracket({ rounds, width: 360, mode: "linear" });
    const byeLine = lineFor(layout, 1, "I5");
    expect(ruleY(lineFor(layout, 2, "I5"))).toBeCloseTo(ruleY(byeLine));
  });

  it("styles winners, losers, pending competitors and the champion", () => {
    const rounds = simulate(4, 2, true);
    const layout = layoutBracket({ rounds, width: 360, mode: "linear" });
    expect(lineFor(layout, 1, "I1").state).toBe("winner");
    expect(lineFor(layout, 1, "I2").state).toBe("loser");
    expect(lineFor(layout, 2, "I1").state).toBe("pending");
    expect(linesOfRound(layout, 3)[0].state).toBe("placeholder");
  });

  it("draws empty placeholder slots for rounds that do not exist yet", () => {
    const rounds = simulate(13, 1, true);
    const layout = layoutBracket({ rounds, width: 800, mode: "linear" });
    expect(layout.columns.map((c) => c.label)).toEqual([
      "ROUND 1",
      "ROUND 2",
      "ROUND 3",
      "FINAL",
      "WINNER",
    ]);
    expect(linesOfRound(layout, 1)).toHaveLength(13);
    const round2 = linesOfRound(layout, 2);
    expect(round2).toHaveLength(7);
    expect(round2.every((l) => l.state === "placeholder")).toBe(true);
    // Round 2 is even-numbered, so its bye sits in the first slot.
    expect(round2.filter((l) => l.slot === 0)).toHaveLength(1);
    expect(linesOfRound(layout, 3)).toHaveLength(4);
    expect(linesOfRound(layout, 4)).toHaveLength(2);
    expect(linesOfRound(layout, 5)).toHaveLength(1);
  });

  it("drops the winner column when the columns would get too narrow", () => {
    const rounds = simulate(13, 1, true);
    const layout = layoutBracket({ rounds, width: 360, mode: "linear" });
    expect(layout.columns.map((c) => c.label)).toEqual([
      "ROUND 1",
      "ROUND 2",
      "ROUND 3",
      "FINAL",
    ]);
    expect(linesOfRound(layout, 5)).toHaveLength(0);
  });

  it("styles the final's winner as champion when the winner column is dropped", () => {
    const rounds = simulate(13, 4);
    const layout = layoutBracket({ rounds, width: 360, mode: "linear" });
    expect(layout.columns.map((c) => c.label)).not.toContain("WINNER");
    const finalLines = linesOfRound(layout, 4);
    expect(finalLines.map((l) => l.state).sort()).toEqual(["champion", "loser"]);
  });

  it("highlights the lines and column of the requested round", () => {
    const rounds = simulate(4, 2, true);
    const layout = layoutBracket({ rounds, width: 360, mode: "linear", highlightRound: 1 });
    expect(linesOfRound(layout, 1).every((l) => l.highlighted)).toBe(true);
    expect(linesOfRound(layout, 2).some((l) => l.highlighted)).toBe(false);
    expect(layout.columns.find((c) => c.label === "ROUND 1")?.highlighted).toBe(true);
    expect(layout.columns.find((c) => c.label === "FINAL")?.highlighted).toBe(false);
  });

  it("marks tiebroken matchups with a coin-flip marker", () => {
    const rounds: BracketRound[] = [
      {
        round: 1,
        matchups: [
          matchup(1, 0, "A", "B", { winner: "A", tiebreak: true }),
          matchup(1, 1, "C", "D", { winner: "C" }),
        ],
      },
    ];
    const layout = layoutBracket({ rounds, width: 360, mode: "linear" });
    expect(layout.markers).toHaveLength(1);
  });

  it("never draws outside the given width", () => {
    const rounds = simulate(16, 4);
    const layout = layoutBracket({ rounds, width: 320, mode: "linear" });
    for (const line of layout.lines) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x + line.width).toBeLessThanOrEqual(320 + 0.01);
    }
    for (const seg of layout.segments) {
      expect(seg.x + seg.width).toBeLessThanOrEqual(320 + 0.01);
    }
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe("layoutBracket (mirrored)", () => {
  it("splits a wide bracket into two halves around the champion", () => {
    const layout = layoutBracket({ rounds: simulate(8, 3), width: 1200, mode: "auto" });
    expect(layout.mode).toBe("mirrored");
    expect(layout.columns.map((c) => c.label)).toEqual([
      "ROUND 1",
      "ROUND 2",
      "FINAL",
      "CHAMPION",
      "FINAL",
      "ROUND 2",
      "ROUND 1",
    ]);
    const round1 = linesOfRound(layout, 1);
    expect(round1.filter((l) => l.x + l.width / 2 < 600)).toHaveLength(4);
    expect(round1.filter((l) => l.x + l.width / 2 > 600)).toHaveLength(4);
    expect(linesOfRound(layout, 4)[0].state).toBe("champion");
  });

  it("puts the finalists on opposite sides of the champion", () => {
    const layout = layoutBracket({ rounds: simulate(8, 3), width: 1200, mode: "auto" });
    const [left, right] = linesOfRound(layout, 3).sort((a, b) => a.x - b.x);
    const champion = linesOfRound(layout, 4)[0];
    expect(left.x + left.width).toBeLessThanOrEqual(champion.x);
    expect(right.x).toBeGreaterThanOrEqual(champion.x + champion.width);
  });

  it("follows the real bracket structure when the halves are uneven", () => {
    // 13 items: the final's left subtree holds 6 items, the right holds 7.
    const layout = layoutBracket({ rounds: simulate(13, 4), width: 1400, mode: "mirrored" });
    const round1 = linesOfRound(layout, 1);
    expect(round1.filter((l) => l.x + l.width / 2 < 700)).toHaveLength(6);
    expect(round1.filter((l) => l.x + l.width / 2 > 700)).toHaveLength(7);
  });

  it("knows the halves before the final exists", () => {
    const layout = layoutBracket({ rounds: simulate(13, 1, true), width: 1400, mode: "mirrored" });
    const round1 = linesOfRound(layout, 1);
    expect(round1.filter((l) => l.x + l.width / 2 < 700)).toHaveLength(6);
    expect(round1.filter((l) => l.x + l.width / 2 > 700)).toHaveLength(7);
  });

  it("falls back to the linear layout on a phone width", () => {
    const layout = layoutBracket({ rounds: simulate(8, 3), width: 360, mode: "auto" });
    expect(layout.mode).toBe("linear");
  });
});
