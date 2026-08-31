import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  api,
  addItems,
  createRoom,
  join,
  start,
  startedVoteRoom,
  submitVote,
  completeVoting,
  getRoom,
  getResults,
  CREATOR,
  BOB,
  GHOST,
} from "./helpers";

async function insertGhostVotes(roomId: string, items: { id: string }[]) {
  for (const item of items) {
    await env.DB.prepare(
      "INSERT INTO votes (id, room_id, item_id, voter_id, voter_name, vote) VALUES (?, ?, ?, ?, ?, 'yes')"
    )
      .bind(crypto.randomUUID(), roomId, item.id, GHOST.voterId, GHOST.name)
      .run();
  }
}

describe("vote membership", () => {
  it("rejects votes from voters who never joined the room", async () => {
    const { code, roomId, items } = await startedVoteRoom();

    const res = await submitVote(code, GHOST, items[0].id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM votes WHERE room_id = ?"
    )
      .bind(roomId)
      .first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  it("does not count non-participant vote rows toward auto-reveal", async () => {
    const { code, roomId, items } = await startedVoteRoom();
    await insertGhostVotes(roomId, items);

    // Creator finishes; Bob has not voted. Ghost rows must not tip the count.
    await completeVoting(code, CREATOR, items);
    let room = await getRoom(code);
    expect(room.body.status).toBe("voting");

    // Bob finishes; now every real participant is done.
    await completeVoting(code, BOB, items);
    room = await getRoom(code);
    expect(room.body.status).toBe("revealed");
  });

  it("does not count non-participant vote rows in pending results progress", async () => {
    const { code, roomId, items } = await startedVoteRoom();
    await insertGhostVotes(roomId, items);

    const res = await getResults(code);
    expect(res.status).toBe(200);
    expect(res.body.revealed).toBe(false);
    expect(res.body.completedCount).toBe(0);
    expect(res.body.totalVoters).toBe(2);
  });
});

describe("rank membership", () => {
  async function startedRankRoom() {
    const { code, roomId } = await createRoom("rank");
    await addItems(code, ["A", "B", "C", "D", "E"]);
    await join(code, BOB);
    await start(code);
    return { code, roomId };
  }

  it("rejects rankings from voters who never joined the room", async () => {
    const { code, roomId } = await startedRankRoom();

    const item = await env.DB.prepare(
      "SELECT id FROM items WHERE room_id = ? LIMIT 1"
    )
      .bind(roomId)
      .first<{ id: string }>();

    const res = await api("POST", `/rooms/${code}/rankings`, {
      itemId: item!.id,
      voterId: GHOST.voterId,
      voterName: GHOST.name,
      rank: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects next-item for voters who never joined the room", async () => {
    const { code } = await startedRankRoom();
    const res = await api(
      "GET",
      `/rooms/${code}/next-item?voterId=${encodeURIComponent(GHOST.voterId)}`
    );
    expect(res.status).toBe(400);
  });
});
