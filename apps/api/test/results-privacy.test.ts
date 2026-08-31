import { describe, it, expect } from "vitest";
import {
  api,
  addItems,
  createRoom,
  join,
  start,
  getRoom,
  getResults,
  getParticipants,
  expectNoVoterIds,
  CREATOR,
  BOB,
  EVE,
} from "./helpers";

describe("rank results privacy", () => {
  it("identifies players by participantId and isYou, never voter ids", async () => {
    const { code } = await createRoom("rank");
    await addItems(code, ["A", "B", "C", "D", "E"]);
    await join(code, BOB);
    await start(code);

    // Both players place all five items via the blind next-item flow.
    for (const p of [CREATOR, BOB]) {
      for (let rank = 1; rank <= 5; rank++) {
        const next = await api(
          "GET",
          `/rooms/${code}/next-item?voterId=${encodeURIComponent(p.voterId)}`
        );
        expect(next.status).toBe(200);
        const submit = await api("POST", `/rooms/${code}/rankings`, {
          itemId: next.body.item.id,
          voterId: p.voterId,
          voterName: p.name,
          rank,
        });
        expect(submit.status).toBe(201);
      }
    }

    const res = await getResults(code, CREATOR.voterId);
    expect(res.status).toBe(200);
    expect(res.body.revealed).toBe(true);

    expect(res.body.players).toHaveLength(2);
    for (const player of res.body.players) {
      expect(typeof player.participantId).toBe("string");
      expect(player).not.toHaveProperty("voterId");
      expect(player.rankings).toHaveLength(5);
    }
    // Caller sorts first and is flagged.
    expect(res.body.players[0].name).toBe("Cass");
    expect(res.body.players[0].isYou).toBe(true);
    expect(res.body.players[1].isYou).toBe(false);
    expectNoVoterIds(res.body);
  });
});

describe("tier results privacy", () => {
  it("identifies players by participantId and isYou, never voter ids", async () => {
    const { code } = await createRoom("tier");
    const items = await addItems(code, ["X", "Y", "Z"]);
    await join(code, BOB);
    await start(code);

    for (const p of [CREATOR, BOB]) {
      const res = await api("POST", `/rooms/${code}/tiers`, {
        voterId: p.voterId,
        voterName: p.name,
        placements: items.map((i, idx) => ({
          itemId: i.id,
          tier: ["S", "A", "B"][idx],
        })),
      });
      expect(res.status).toBe(201);
    }

    const res = await getResults(code, BOB.voterId);
    expect(res.body.revealed).toBe(true);
    for (const player of res.body.players) {
      expect(typeof player.participantId).toBe("string");
      expect(player).not.toHaveProperty("voterId");
    }
    expect(res.body.players[0].name).toBe("Bob");
    expect(res.body.players[0].isYou).toBe(true);
    expectNoVoterIds(res.body);
  });
});

describe("mlt privacy", () => {
  it("targets, tallies, and leaderboard use participant ids end to end", async () => {
    const { code } = await createRoom("mlt");
    await addItems(code, ["Prompt 1", "Prompt 2", "Prompt 3"]);
    await join(code, BOB);
    await join(code, EVE);

    const parts = await getParticipants(code);
    const bobParticipantId = parts.body.participants.find(
      (p: any) => p.name === "Bob"
    ).participantId;
    expect(typeof bobParticipantId).toBe("string");

    await start(code);

    const roomRes = await getRoom(code);
    const items = roomRes.body.items as { id: string }[];

    // Everyone votes Bob on every prompt, addressed by participant id.
    for (const p of [CREATOR, BOB, EVE]) {
      for (const item of items) {
        const res = await api("POST", `/rooms/${code}/mlt-votes`, {
          itemId: item.id,
          voterId: p.voterId,
          voterName: p.name,
          targetParticipantId: bobParticipantId,
        });
        expect(res.status).toBe(201);
      }
    }

    // Resume payload speaks participant ids too.
    const myRoom = await getRoom(code, CREATOR.voterId);
    expect(Object.values(myRoom.body.myMltVotes)).toEqual([
      bobParticipantId,
      bobParticipantId,
      bobParticipantId,
    ]);
    expectNoVoterIds(myRoom.body);

    const res = await getResults(code, CREATOR.voterId);
    expect(res.body.revealed).toBe(true);

    for (const prompt of res.body.prompts) {
      for (const tally of prompt.tallies) {
        expect(typeof tally.targetParticipantId).toBe("string");
        expect(tally).not.toHaveProperty("targetVoterId");
      }
      expect(prompt.winners).toEqual([
        { participantId: bobParticipantId, name: "Bob" },
      ]);
    }

    const bobEntry = res.body.leaderboard.find((e: any) => e.name === "Bob");
    expect(bobEntry.participantId).toBe(bobParticipantId);
    expect(bobEntry.wins).toBe(3);
    expect(res.body.leaderboard.find((e: any) => e.name === "Cass").isYou).toBe(
      true
    );
    expectNoVoterIds(res.body);
  });
});

describe("bracket privacy", () => {
  it("vote breakdowns show names and isYou, never voter ids", async () => {
    const { code } = await createRoom("bracket");
    await addItems(code, ["A", "B", "C", "D"]);
    await join(code, BOB);
    await start(code);

    // Play both rounds: everyone picks itemA so no coin flips are needed.
    for (let round = 0; round < 2; round++) {
      const bracketRes = await api(
        "GET",
        `/rooms/${code}/bracket?voterId=${encodeURIComponent(CREATOR.voterId)}`
      );
      const rounds = bracketRes.body.rounds;
      const current = rounds[rounds.length - 1];
      for (const matchup of current.matchups) {
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
    }

    // Live bracket view.
    const bracketRes = await api(
      "GET",
      `/rooms/${code}/bracket?voterId=${encodeURIComponent(CREATOR.voterId)}`
    );
    const firstRound = bracketRes.body.rounds[0];
    const breakdown = firstRound.matchups[0].voteBreakdown;
    expect(breakdown).toHaveLength(2);
    for (const entry of breakdown) {
      expect(entry).not.toHaveProperty("voterId");
      expect(typeof entry.voterName).toBe("string");
    }
    expect(breakdown.find((e: any) => e.voterName === "Cass").isYou).toBe(true);
    expect(breakdown.find((e: any) => e.voterName === "Bob").isYou).toBe(false);
    expectNoVoterIds(bracketRes.body);

    // Revealed results view.
    const res = await getResults(code, CREATOR.voterId);
    expect(res.body.revealed).toBe(true);
    expect(res.body.winner).not.toBeNull();
    for (const round of res.body.rounds) {
      for (const matchup of round.matchups) {
        for (const entry of matchup.voteBreakdown ?? []) {
          expect(entry).not.toHaveProperty("voterId");
        }
      }
    }
    expectNoVoterIds(res.body);
  });
});
