import { describe, it, expect } from "vitest";
import { api, createRoom, addItems, join, start, getResults, CREATOR, BOB } from "./helpers";

// Rolling byes: every round plays floor(N/2) matchups and sits out at most one
// item. The bye takes the last slot in odd-numbered rounds and the first slot
// in even-numbered rounds, so nobody sits out twice in a row and the bracket
// shape is fully determined by the item count.

async function startedBracket(itemCount: number): Promise<string> {
  const { code } = await createRoom("bracket");
  await addItems(
    code,
    Array.from({ length: itemCount }, (_, i) => `Item ${i + 1}`)
  );
  const joined = await join(code, BOB);
  expect(joined.status).toBe(200);
  await start(code);
  return code;
}

async function getBracket(code: string) {
  const res = await api(
    "GET",
    `/rooms/${code}/bracket?voterId=${encodeURIComponent(CREATOR.voterId)}`
  );
  expect(res.status).toBe(200);
  return res.body;
}

/** Both players pick itemA on every real matchup in the latest round. */
async function playLatestRound(code: string) {
  const bracket = await getBracket(code);
  const current = bracket.rounds[bracket.rounds.length - 1];
  for (const matchup of current.matchups) {
    if (matchup.isBye) continue;
    for (const p of [CREATOR, BOB]) {
      const res = await api("POST", `/rooms/${code}/matchup-votes`, {
        matchupId: matchup.id,
        voterId: p.voterId,
        voterName: p.name,
        pickedItemId: matchup.itemA.id,
      });
      expect(res.status).toBe(201);
    }
  }
  return getBracket(code);
}

/** Play rounds until the room reveals; returns the final bracket payload. */
async function playToFinish(code: string) {
  let bracket = await getBracket(code);
  while (bracket.currentRound !== null) {
    bracket = await playLatestRound(code);
  }
  return bracket;
}

function shapeOf(round: any): { real: number; byes: number } {
  return {
    real: round.matchups.filter((m: any) => !m.isBye).length,
    byes: round.matchups.filter((m: any) => m.isBye).length,
  };
}

function byeSlotsOf(round: any): number[] {
  return round.matchups.filter((m: any) => m.isBye).map((m: any) => m.slot);
}

function byeItemsOf(round: any): string[] {
  return round.matchups.filter((m: any) => m.isBye).map((m: any) => m.itemA.id);
}

describe("bracket rolling byes", () => {
  it("13 items: round 1 plays 6 matchups and sits out one item in the last slot", async () => {
    const code = await startedBracket(13);
    const bracket = await getBracket(code);

    expect(bracket.totalRounds).toBe(4);
    expect(bracket.rounds).toHaveLength(1);
    expect(shapeOf(bracket.rounds[0])).toEqual({ real: 6, byes: 1 });
    expect(byeSlotsOf(bracket.rounds[0])).toEqual([6]);
  });

  it("13 items: rounds narrow 7 → 4 → 2 → 1 with at most one bye per round", async () => {
    const code = await startedBracket(13);
    const bracket = await playToFinish(code);

    expect(bracket.rounds.map(shapeOf)).toEqual([
      { real: 6, byes: 1 },
      { real: 3, byes: 1 },
      { real: 2, byes: 0 },
      { real: 1, byes: 0 },
    ]);

    const results = await getResults(code, CREATOR.voterId);
    expect(results.body.revealed).toBe(true);
    expect(results.body.totalRounds).toBe(4);
    expect(results.body.winner).not.toBeNull();
  });

  it("alternates the bye between the last and first slot by round parity", async () => {
    const code = await startedBracket(9);
    const bracket = await playToFinish(code);

    expect(bracket.rounds.map(shapeOf)).toEqual([
      { real: 4, byes: 1 },
      { real: 2, byes: 1 },
      { real: 1, byes: 1 },
      { real: 1, byes: 0 },
    ]);
    expect(byeSlotsOf(bracket.rounds[0])).toEqual([4]); // round 1: last
    expect(byeSlotsOf(bracket.rounds[1])).toEqual([0]); // round 2: first
    expect(byeSlotsOf(bracket.rounds[2])).toEqual([1]); // round 3: last
  });

  it("never gives the same item a bye in two consecutive rounds", async () => {
    const code = await startedBracket(9);
    const bracket = await playToFinish(code);

    for (let i = 1; i < bracket.rounds.length; i++) {
      const previous = byeItemsOf(bracket.rounds[i - 1]);
      const current = byeItemsOf(bracket.rounds[i]);
      for (const item of current) {
        expect(previous).not.toContain(item);
      }
    }
  });

  it("a bye carries its item into the next round undefeated", async () => {
    const code = await startedBracket(5);
    const bracket = await playToFinish(code);

    const round1Bye = bracket.rounds[0].matchups.find((m: any) => m.isBye);
    expect(round1Bye.winner.id).toBe(round1Bye.itemA.id);

    const round2Competitors = bracket.rounds[1].matchups.flatMap((m: any) =>
      [m.itemA?.id, m.itemB?.id].filter(Boolean)
    );
    expect(round2Competitors).toContain(round1Bye.itemA.id);
  });

  it("4 items: still two clean rounds with no byes", async () => {
    const code = await startedBracket(4);
    const bracket = await playToFinish(code);

    expect(bracket.rounds.map(shapeOf)).toEqual([
      { real: 2, byes: 0 },
      { real: 1, byes: 0 },
    ]);
  });
});
