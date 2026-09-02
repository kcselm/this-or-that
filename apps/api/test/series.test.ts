import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { createRoom, getParticipants, expectNoVoterIds, pickNextHost, revealedRankRoom, join, addItems, start, reveal, BOB, EVE, CREATOR, createNextRound, addItemsAs, startAs, getRoom, startedVoteRoom, api } from "./helpers";

async function pickedBob(code: string): Promise<string> {
  const parts = await getParticipants(code);
  const bobId = parts.body.participants.find((p: any) => p.name === "Bob").participantId;
  const res = await pickNextHost(code, bobId);
  expect(res.status).toBe(200);
  return bobId;
}

describe("room series schema", () => {
  it("a new room is round 1 of no series", async () => {
    const { roomId } = await createRoom("rank");
    const row = await env.DB.prepare(
      "SELECT series_id, round_number, next_host_voter_id, next_room_id FROM rooms WHERE id = ?"
    )
      .bind(roomId)
      .first<any>();
    expect(row).toEqual({
      series_id: null,
      round_number: 1,
      next_host_voter_id: null,
      next_room_id: null,
    });
  });
});

describe("POST /rooms/:code/next-host", () => {
  it("host picks a specific participant", async () => {
    const { code, roomId } = await revealedRankRoom();
    const parts = await getParticipants(code);
    const bobId = parts.body.participants.find((p: any) => p.name === "Bob").participantId;

    const res = await pickNextHost(code, bobId);
    expect(res.status).toBe(200);
    expect(res.body.nextHost).toEqual({ participantId: bobId, name: "Bob" });
    expectNoVoterIds(res.body);

    const row = await env.DB.prepare("SELECT next_host_voter_id FROM rooms WHERE id = ?")
      .bind(roomId)
      .first<{ next_host_voter_id: string }>();
    expect(row?.next_host_voter_id).toBe(BOB.voterId);
  });

  it("re-picking overwrites the previous pick", async () => {
    const { code, roomId } = await revealedRankRoom();
    const parts = await getParticipants(code);
    const bobId = parts.body.participants.find((p: any) => p.name === "Bob").participantId;
    const cassId = parts.body.participants.find((p: any) => p.name === "Cass").participantId;

    await pickNextHost(code, bobId);
    const res = await pickNextHost(code, cassId);
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT next_host_voter_id FROM rooms WHERE id = ?")
      .bind(roomId)
      .first<{ next_host_voter_id: string }>();
    expect(row?.next_host_voter_id).toBe(CREATOR.voterId);
  });

  it("random pick never chooses someone who already hosted", async () => {
    const { code } = await revealedRankRoom();
    // CREATOR hosted round 1; BOB is the only participant who hasn't.
    const res = await pickNextHost(code);
    expect(res.status).toBe(200);
    expect(res.body.nextHost.name).toBe("Bob");
  });

  it("non-creator cannot pick", async () => {
    const { code } = await revealedRankRoom();
    const res = await pickNextHost(code, undefined, BOB.voterId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_CREATOR");
  });

  it("rejected before results are revealed", async () => {
    const { code } = await createRoom("rank");
    await addItems(code, ["A", "B", "C", "D", "E"]);
    await join(code, BOB);
    await start(code); // status = voting, not revealed
    const res = await pickNextHost(code);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("rejected on non-rank rooms", async () => {
    const { code } = await createRoom("vote");
    await addItems(code, ["A", "B"]);
    await join(code, BOB);
    await start(code);
    await reveal(code);
    const res = await pickNextHost(code);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("unknown participant id is rejected", async () => {
    const { code } = await revealedRankRoom();
    const res = await pickNextHost(code, "not-a-participant-id");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /rooms with previousRoomCode", () => {
  it("the designated next host creates round 2, linked into a series", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);

    const res = await createNextRound(code, BOB);
    expect(res.status).toBe(201);
    expectNoVoterIds(res.body);
    expect(res.body.roundNumber).toBe(2);

    const newRoom = await env.DB.prepare(
      "SELECT series_id, round_number FROM rooms WHERE id = ?"
    )
      .bind(res.body.id)
      .first<any>();
    expect(newRoom).toEqual({ series_id: roomId, round_number: 2 });

    const prev = await env.DB.prepare(
      "SELECT series_id, next_room_id FROM rooms WHERE id = ?"
    )
      .bind(roomId)
      .first<any>();
    expect(prev).toEqual({ series_id: roomId, next_room_id: res.body.id });
  });

  it("a caller who wasn't picked gets 403", async () => {
    const { code } = await revealedRankRoom();
    await pickedBob(code);
    const res = await createNextRound(code, EVE);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_NEXT_HOST");
  });

  it("no next host picked yet means 403", async () => {
    const { code } = await revealedRankRoom();
    const res = await createNextRound(code, BOB);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_NEXT_HOST");
  });

  it("cannot continue a room that isn't revealed", async () => {
    const { code } = await createRoom("rank");
    await addItems(code, ["A", "B", "C", "D", "E"]);
    const res = await createNextRound(code, BOB);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("a second successor gets 409 and leaves no orphan room", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);
    const first = await createNextRound(code, BOB);
    expect(first.status).toBe(201);

    const second = await createNextRound(code, BOB);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("SERIES_CONTINUED");

    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM rooms WHERE series_id = ?"
    )
      .bind(roomId)
      .first<{ c: number }>();
    expect(count?.c).toBe(2); // round 1 (backfilled) + round 2, nothing else
  });

  it("concurrent duplicate creates yield one 201 and one 409", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);

    const [a, b] = await Promise.all([
      createNextRound(code, BOB),
      createNextRound(code, BOB),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM rooms WHERE series_id = ?"
    )
      .bind(roomId)
      .first<{ c: number }>();
    expect(count?.c).toBe(2);
  });

  it("next-host is locked once the series has continued", async () => {
    const { code } = await revealedRankRoom();
    const bobId = await pickedBob(code);
    const created = await createNextRound(code, BOB);
    expect(created.status).toBe(201);

    const res = await pickNextHost(code, bobId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SERIES_CONTINUED");
  });

  it("round 3 keeps the original series id, and the reset random pool skips the current host", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);
    const r2 = await createNextRound(code, BOB);
    const code2 = r2.body.code as string;

    // Play round 2 to reveal: CREATOR joins, BOB (the new creator) runs it.
    await join(code2, CREATOR);
    await addItemsAs(code2, ["F", "G", "H", "I", "J"], BOB);
    await startAs(code2, BOB);
    await reveal(code2, BOB.voterId);

    // Both participants have hosted → pool resets minus BOB (current host).
    const pick = await pickNextHost(code2, undefined, BOB.voterId);
    expect(pick.status).toBe(200);
    expect(pick.body.nextHost.name).toBe("Cass");

    const r3 = await createNextRound(code2, CREATOR);
    expect(r3.status).toBe(201);
    expect(r3.body.roundNumber).toBe(3);
    const room3 = await env.DB.prepare("SELECT series_id FROM rooms WHERE id = ?")
      .bind(r3.body.id)
      .first<{ series_id: string }>();
    expect(room3?.series_id).toBe(roomId);
  });
});

describe("series exposure on GET /status and GET /rooms/:code", () => {
  it("a revealed rank room starts with no next host or next room", async () => {
    const { code } = await revealedRankRoom();
    const res = await api("GET", `/rooms/${code}/status`);
    expect(res.status).toBe(200);
    expect(res.body.roundNumber).toBe(1);
    expect(res.body.nextHost).toBeNull();
    expect(res.body.nextRoomCode).toBeNull();
    expectNoVoterIds(res.body);
  });

  it("status shows the picked next host by participant id only", async () => {
    const { code } = await revealedRankRoom();
    const bobId = await pickedBob(code);
    const res = await api("GET", `/rooms/${code}/status`);
    expect(res.body.nextHost).toEqual({ participantId: bobId, name: "Bob" });
    expectNoVoterIds(res.body);
  });

  it("status and room GETs point at the NEWEST round in the series", async () => {
    // Build a 3-round chain.
    const { code } = await revealedRankRoom();
    await pickedBob(code);
    const r2 = await createNextRound(code, BOB);
    const code2 = r2.body.code as string;
    await join(code2, CREATOR);
    await addItemsAs(code2, ["F", "G", "H", "I", "J"], BOB);
    await startAs(code2, BOB);
    await reveal(code2, BOB.voterId);
    await pickNextHost(code2, undefined, BOB.voterId); // resets pool → Cass
    const r3 = await createNextRound(code2, CREATOR);
    const code3 = r3.body.code as string;

    const s1 = await api("GET", `/rooms/${code}/status`);
    expect(s1.body.nextRoomCode).toBe(code3); // multi-hop resolution
    const s2 = await api("GET", `/rooms/${code2}/status`);
    expect(s2.body.nextRoomCode).toBe(code3);
    const s3 = await api("GET", `/rooms/${code3}/status`);
    expect(s3.body.roundNumber).toBe(3);
    expect(s3.body.nextRoomCode).toBeNull();

    const room1 = await getRoom(code);
    expect(room1.body.nextRoomCode).toBe(code3);
    expect(room1.body.roundNumber).toBe(1);
  });

  it("vote-mode status keeps its existing shape", async () => {
    const { code } = await startedVoteRoom();
    const res = await api("GET", `/rooms/${code}/status`);
    expect(res.status).toBe(200);
    expect(res.body.roundNumber).toBeUndefined();
    expect(res.body.nextHost).toBeUndefined();
    expect(res.body.nextRoomCode).toBeUndefined();
  });
});
