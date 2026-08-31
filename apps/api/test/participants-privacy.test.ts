import { describe, it, expect } from "vitest";
import {
  api,
  createRoom,
  join,
  getParticipants,
  getRoom,
  expectNoVoterIds,
  CREATOR,
  BOB,
} from "./helpers";

describe("harness sanity", () => {
  it("creates a room with a 6-character code", async () => {
    const { code } = await createRoom("vote");
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });
});

describe("participants endpoint privacy", () => {
  it("returns public participant ids and names, never voter ids", async () => {
    const { code } = await createRoom("vote");
    await join(code, BOB);

    const res = await getParticipants(code);
    expect(res.status).toBe(200);

    const rows = res.body.participants;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(typeof row.participantId).toBe("string");
      expect(row.participantId.length).toBeGreaterThan(0);
      expect(row).not.toHaveProperty("voterId");
    }
    expect(rows.find((r: any) => r.name === "Cass").isCreator).toBe(true);
    expect(rows.find((r: any) => r.name === "Bob").isCreator).toBe(false);
    expectNoVoterIds(res.body);
  });

  it("marks the calling voter with isYou when voterId is supplied", async () => {
    const { code } = await createRoom("vote");
    await join(code, BOB);

    const res = await getParticipants(code, BOB.voterId);
    const rows = res.body.participants;
    expect(rows.find((r: any) => r.name === "Bob").isYou).toBe(true);
    expect(rows.find((r: any) => r.name === "Cass").isYou).toBe(false);
    expectNoVoterIds(res.body);
  });
});

describe("room details privacy", () => {
  it("exposes suggester names but not their voter ids on items", async () => {
    const { code } = await createRoom("vote", { allowSuggestions: true });
    await join(code, BOB);

    const added = await api("POST", `/rooms/${code}/items`, {
      item: "Tacos",
      voterId: BOB.voterId,
      voterName: BOB.name,
    });
    expect(added.status).toBe(201);

    const res = await getRoom(code, CREATOR.voterId);
    expect(res.status).toBe(200);
    const taco = res.body.items.find((i: any) => i.title === "Tacos");
    expect(taco.addedBy).toEqual({ name: "Bob" });
    expectNoVoterIds(res.body);
  });
});
