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
  getParticipants,
  CREATOR,
  BOB,
  EVE,
} from "./helpers";

// Concurrent requests interleave at await points inside the Worker, so a
// SELECT-then-INSERT "upsert" lets both requests pass the SELECT and the
// second INSERT dies on the UNIQUE constraint with a 500.

describe("concurrent vote submission", () => {
  it("a double-tapped vote never 500s and leaves one row", async () => {
    const { code, roomId, items } = await startedVoteRoom();

    const [a, b] = await Promise.all([
      submitVote(code, CREATOR, items[0].id, "yes"),
      submitVote(code, CREATOR, items[0].id, "no"),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM votes WHERE room_id = ? AND item_id = ? AND voter_id = ?"
    )
      .bind(roomId, items[0].id, CREATOR.voterId)
      .first<{ c: number }>();
    expect(count?.c).toBe(1);
  });
});

describe("concurrent mlt vote submission", () => {
  it("a double-tapped mlt vote never 500s and leaves one row", async () => {
    const { code, roomId } = await createRoom("mlt");
    await addItems(code, ["P1", "P2", "P3"]);
    await join(code, BOB);
    await join(code, EVE);

    const parts = await getParticipants(code);
    const bobId = parts.body.participants.find(
      (p: any) => p.name === "Bob"
    ).participantId;

    await start(code);

    const item = await env.DB.prepare(
      "SELECT id FROM items WHERE room_id = ? LIMIT 1"
    )
      .bind(roomId)
      .first<{ id: string }>();

    const cast = () =>
      api("POST", `/rooms/${code}/mlt-votes`, {
        itemId: item!.id,
        voterId: CREATOR.voterId,
        voterName: CREATOR.name,
        targetParticipantId: bobId,
      });
    const [a, b] = await Promise.all([cast(), cast()]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM mlt_votes WHERE room_id = ? AND item_id = ? AND voter_id = ?"
    )
      .bind(roomId, item!.id, CREATOR.voterId)
      .first<{ c: number }>();
    expect(count?.c).toBe(1);
  });
});

describe("concurrent start", () => {
  const startReq = (code: string) =>
    api("POST", `/rooms/${code}/start`, { creatorVoterId: CREATOR.voterId });

  it("a bracket room started twice at once yields one winner, one clean 400", async () => {
    const { code, roomId } = await createRoom("bracket");
    await addItems(code, ["A", "B", "C", "D"]);
    await join(code, BOB);

    const [a, b] = await Promise.all([startReq(code), startReq(code)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.error.code).toBe("INVALID_STATUS");

    // Exactly one round-1 bracket was built.
    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM matchups WHERE room_id = ? AND round = 1"
    )
      .bind(roomId)
      .first<{ c: number }>();
    expect(count?.c).toBe(2);
  });

  it("a rank room started twice at once shuffles exactly once", async () => {
    const { code, roomId } = await createRoom("rank");
    await addItems(code, ["A", "B", "C", "D", "E"]);
    await join(code, BOB);

    const [a, b] = await Promise.all([startReq(code), startReq(code)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);

    // Every item got a distinct presentation slot 0-4.
    const { results: rows } = await env.DB.prepare(
      "SELECT presentation_order FROM items WHERE room_id = ? ORDER BY presentation_order"
    )
      .bind(roomId)
      .all<{ presentation_order: number | null }>();
    expect(rows.map((r) => r.presentation_order)).toEqual([0, 1, 2, 3, 4]);
  });
});
