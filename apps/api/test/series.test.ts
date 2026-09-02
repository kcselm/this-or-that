import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { createRoom, getParticipants, expectNoVoterIds, pickNextHost, revealedRankRoom, join, addItems, start, reveal, BOB, EVE, CREATOR } from "./helpers";

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
