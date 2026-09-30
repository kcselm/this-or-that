import { describe, it, expect } from "vitest";
import {
  api,
  createRoom,
  addItems,
  join,
  start,
  getResults,
  getParticipants,
  startedVoteRoom,
  completeVoting,
  submitVote,
  CREATOR,
  BOB,
  EVE,
} from "./helpers";

type Player = { voterId: string; name: string };

async function getStatus(code: string) {
  return (await api("GET", `/rooms/${code}/status`)).body;
}

/** Create a room in `mode`, add items, join players, and start it. */
async function startedRoom(
  mode: "rank" | "bracket" | "mlt" | "tier",
  titles: string[],
  players: Player[]
) {
  const { code } = await createRoom(mode);
  const items = await addItems(code, titles);
  for (const p of players) expect((await join(code, p)).status).toBe(200);
  await start(code);
  return { code, items };
}

describe("swipe vote", () => {
  it("reveals once every participant has voted on every item, ranked by yes-percentage", async () => {
    const { code, items } = await startedVoteRoom(["Pizza", "Sushi", "Tacos"], [BOB]);
    const [pizza, sushi, tacos] = items;

    for (const [item, creatorVote, bobVote] of [
      [pizza, "no", "no"],
      [sushi, "yes", "no"],
      [tacos, "yes", "yes"],
    ] as const) {
      await submitVote(code, CREATOR, item.id, creatorVote);
      expect((await getStatus(code)).isRevealed).toBe(false);
      await submitVote(code, BOB, item.id, bobVote);
    }

    const status = await getStatus(code);
    expect(status).toMatchObject({ isRevealed: true, totalVoters: 2, completedCount: 2 });

    const res = await getResults(code);
    expect(res.body).toMatchObject({
      revealed: true,
      mode: "vote",
      topic: "Test topic",
      totalVoters: 2,
    });
    expect(res.body.results.map((r: any) => [r.title, r.yesPercentage])).toEqual([
      ["Tacos", 100],
      ["Sushi", 50],
      ["Pizza", 0],
    ]);
  });

  it("reports progress, with mode, before the reveal", async () => {
    const { code, items } = await startedVoteRoom(["Pizza", "Sushi"], [BOB]);
    await completeVoting(code, CREATOR, items);

    const res = await getResults(code);
    expect(res.body).toEqual({ revealed: false, mode: "vote", completedCount: 1, totalVoters: 2 });
  });

  it("points a submission at the right endpoint when the room is another mode", async () => {
    const { code, items } = await startedRoom("tier", ["A", "B", "C"], [BOB]);
    const res = await submitVote(code, BOB, items[0].id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("/tiers");
  });
});

describe("blind rank", () => {
  it("reveals when every player has filled all five slots", async () => {
    const { code } = await startedRoom("rank", ["A", "B", "C", "D", "E"], [BOB]);

    for (const p of [CREATOR, BOB]) {
      for (let rank = 1; rank <= 5; rank++) {
        const next = await api("GET", `/rooms/${code}/next-item?voterId=${p.voterId}`);
        expect(next.body.progress).toEqual({ placed: rank - 1, total: 5 });
        const placed = await api("POST", `/rooms/${code}/rankings`, {
          itemId: next.body.item.id,
          voterId: p.voterId,
          voterName: p.name,
          rank,
        });
        expect(placed.status).toBe(201);
      }
    }

    const res = await getResults(code, BOB.voterId);
    expect(res.body.revealed).toBe(true);
    expect(res.body.mode).toBe("rank");
    // You first, then the host.
    expect(res.body.players.map((p: any) => p.name)).toEqual([BOB.name, CREATOR.name]);
    expect(res.body.players[0].rankings.map((r: any) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("most likely to", () => {
  it("won't start with fewer than three players", async () => {
    const { code } = await createRoom("mlt");
    await addItems(code, ["Late", "Famous", "Cats"]);
    await join(code, BOB);

    const res = await api("POST", `/rooms/${code}/start`, { creatorVoterId: CREATOR.voterId });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("at least 3 players");
  });

  it("tallies each prompt, credits ties to everyone tied, and ranks the leaderboard", async () => {
    const { code, items } = await startedRoom("mlt", ["Late", "Famous", "Cats"], [BOB, EVE]);
    const { participants } = (await getParticipants(code)).body;
    const idOf = (name: string) => participants.find((p: any) => p.name === name).participantId;

    // "Late": everyone picks Bob. "Famous": a three-way tie. "Cats": Eve, 2-1.
    const picks: [Player, string, string, string][] = [
      [CREATOR, "Bob", "Eve", "Eve"],
      [BOB, "Bob", "Cass", "Eve"],
      [EVE, "Bob", "Bob", "Cass"],
    ];
    for (const [voter, ...targets] of picks) {
      for (const [i, target] of targets.entries()) {
        const item = items[i];
        const res = await api("POST", `/rooms/${code}/mlt-votes`, {
          itemId: item.id,
          voterId: voter.voterId,
          voterName: voter.name,
          targetParticipantId: idOf(target),
        });
        expect(res.status).toBe(201);
      }
    }

    const res = await getResults(code, EVE.voterId);
    expect(res.body).toMatchObject({ revealed: true, mode: "mlt" });
    const [late, famous, cats] = res.body.prompts;
    expect(late.winners.map((w: any) => w.name)).toEqual(["Bob"]);
    expect(late.totalVotes).toBe(3);
    expect(famous.winners.map((w: any) => w.name).sort()).toEqual(["Bob", "Cass", "Eve"]);
    expect(cats.winners.map((w: any) => w.name)).toEqual(["Eve"]);
    expect(res.body.leaderboard.map((e: any) => [e.name, e.wins])).toEqual([
      ["Bob", 2],
      ["Eve", 2],
      ["Cass", 1],
    ]);
    expect(res.body.leaderboard.find((e: any) => e.name === "Eve").isYou).toBe(true);
  });
});

describe("tier list", () => {
  async function lockIn(code: string, p: Player, placements: { itemId: string; tier: string }[]) {
    return api("POST", `/rooms/${code}/tiers`, {
      voterId: p.voterId,
      voterName: p.name,
      placements,
    });
  }

  it("rejects boards that don't place every item exactly once in a real tier", async () => {
    const { code, items } = await startedRoom("tier", ["A", "B", "C"], [BOB]);
    const [a, b, c] = items.map((i) => i.id);

    const missing = await lockIn(code, BOB, [
      { itemId: a, tier: "S" },
      { itemId: b, tier: "A" },
    ]);
    expect(missing.status).toBe(400);

    const duplicate = await lockIn(code, BOB, [
      { itemId: a, tier: "S" },
      { itemId: a, tier: "A" },
      { itemId: b, tier: "B" },
    ]);
    expect(duplicate.status).toBe(400);

    const badTier = await lockIn(code, BOB, [
      { itemId: a, tier: "S" },
      { itemId: b, tier: "A" },
      { itemId: c, tier: "Z" },
    ]);
    expect(badTier.status).toBe(400);
  });

  it("locks a board in once, then reveals a consensus board when everyone has", async () => {
    const { code, items } = await startedRoom("tier", ["A", "B", "C"], [BOB]);
    const [a, b, c] = items.map((i) => i.id);

    const first = await lockIn(code, CREATOR, [
      { itemId: a, tier: "S" },
      { itemId: b, tier: "C" },
      { itemId: c, tier: "D" },
    ]);
    expect(first.status).toBe(201);
    expect(first.body.isRevealed).toBe(false);

    const again = await lockIn(code, CREATOR, [
      { itemId: a, tier: "D" },
      { itemId: b, tier: "D" },
      { itemId: c, tier: "D" },
    ]);
    expect(again.status).toBe(400);

    const last = await lockIn(code, BOB, [
      { itemId: a, tier: "A" },
      { itemId: b, tier: "A" },
      { itemId: c, tier: "D" },
    ]);
    expect(last.body.isRevealed).toBe(true);

    const res = await getResults(code);
    expect(res.body.mode).toBe("tier");
    const byTier = Object.fromEntries(
      res.body.consensus.map((row: any) => [row.tier, row.items.map((i: any) => i.title)])
    );
    // A: (5+4)/2 = 4.5 -> S. B: (2+4)/2 = 3 -> B. C: 1 -> D.
    expect(byTier).toEqual({ S: ["A"], A: [], B: ["B"], C: [], D: ["C"] });
    expect(res.body.players).toHaveLength(2);
  });
});

describe("bracket", () => {
  it("reports per-round progress before the reveal", async () => {
    const { code } = await startedRoom("bracket", ["A", "B", "C", "D"], [BOB]);
    const bracket = await api("GET", `/rooms/${code}/bracket?voterId=${CREATOR.voterId}`);
    for (const m of bracket.body.rounds[0].matchups) {
      await api("POST", `/rooms/${code}/matchup-votes`, {
        matchupId: m.id,
        voterId: CREATOR.voterId,
        voterName: CREATOR.name,
        pickedItemId: m.itemA.id,
      });
    }

    const res = await getResults(code);
    expect(res.body).toEqual({
      revealed: false,
      mode: "bracket",
      completedCount: 1,
      totalVoters: 2,
      currentRound: 1,
      totalThisRound: 2,
    });
  });

  it.todo("force-reveal mid-bracket still crowns a champion");
});

describe("force reveal", () => {
  it("lets only the host reveal early, showing whatever was submitted", async () => {
    const { code, items } = await startedVoteRoom(["Pizza", "Sushi"], [BOB]);
    await completeVoting(code, CREATOR, items);

    const notHost = await api("POST", `/rooms/${code}/reveal`, { creatorVoterId: BOB.voterId });
    expect(notHost.status).toBe(403);

    const reveal = await api("POST", `/rooms/${code}/reveal`, { creatorVoterId: CREATOR.voterId });
    expect(reveal.status).toBe(200);

    const res = await getResults(code);
    expect(res.body).toMatchObject({ revealed: true, mode: "vote", totalVoters: 1 });

    const twice = await api("POST", `/rooms/${code}/reveal`, { creatorVoterId: CREATOR.voterId });
    expect(twice.status).toBe(400);
  });
});

describe("room setup", () => {
  it("caps items at the mode's limit", async () => {
    const { code } = await createRoom("tier");
    await addItems(
      code,
      Array.from({ length: 12 }, (_, i) => `Item ${i}`)
    );

    const over = await api("POST", `/rooms/${code}/items`, {
      item: "One too many",
      creatorVoterId: CREATOR.voterId,
    });
    expect(over.status).toBe(400);
  });

  it("enforces each mode's item-count range at start", async () => {
    const { code } = await createRoom("bracket");
    await addItems(code, ["A", "B", "C"]);

    const tooFew = await api("POST", `/rooms/${code}/start`, { creatorVoterId: CREATOR.voterId });
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.error.message).toBe("Bracket rooms need between 4 and 16 items to start");
  });

  it("lets the host delete items only while the room is open", async () => {
    const { code } = await createRoom("vote");
    const [pizza, sushi] = await addItems(code, ["Pizza", "Sushi", "Tacos"]);
    const del = (itemId: string, voterId = CREATOR.voterId) =>
      api("DELETE", `/rooms/${code}/items/${itemId}?creatorVoterId=${voterId}`);

    expect((await del(pizza.id, BOB.voterId)).status).toBe(403);

    const res = await del(pizza.id);
    expect(res.status).toBe(200);
    expect(res.body.totalItems).toBe(2);

    await start(code);
    expect((await del(sushi.id)).status).toBe(400);
  });

  it.todo("items added after a delete keep a unique sort_order");

  it("keeps suggestions off for modes that don't allow them", async () => {
    const { code } = await createRoom("rank", { allowSuggestions: true });
    const room = await api("GET", `/rooms/${code}`);
    expect(room.body.allowSuggestions).toBe(false);

    const res = await api("PATCH", `/rooms/${code}/settings`, {
      creatorVoterId: CREATOR.voterId,
      allowSuggestions: true,
    });
    expect(res.status).toBe(400);

    await join(code, BOB);
    const add = await api("POST", `/rooms/${code}/items`, {
      item: "Sneaky",
      voterId: BOB.voterId,
      voterName: BOB.name,
    });
    expect(add.status).toBe(400);
  });

  it("rejects whitespace-only names and topics", async () => {
    const blankTopic = await api("POST", "/rooms", {
      topic: "   ",
      creatorVoterId: CREATOR.voterId,
      creatorName: CREATOR.name,
    });
    expect(blankTopic.status).toBe(400);

    const { code } = await createRoom("vote");
    const blankName = await api("POST", `/rooms/${code}/join`, {
      voterId: BOB.voterId,
      voterName: "   ",
    });
    expect(blankName.status).toBe(400);
  });

  it("renames a player who joins again instead of adding them twice", async () => {
    const { code } = await createRoom("vote");
    const [first, second] = await Promise.all([
      join(code, BOB),
      join(code, { voterId: BOB.voterId, name: "Bobby" }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);

    const { participants } = (await getParticipants(code)).body;
    expect(participants).toHaveLength(2);
  });

  it.todo("a JSON body of null is a 400, not a 500");
});
