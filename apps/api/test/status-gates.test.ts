import { describe, it, expect } from "vitest";
import {
  api,
  createRoom,
  join,
  startedVoteRoom,
  completeVoting,
  getResults,
  CREATOR,
  BOB,
  EVE,
} from "./helpers";

async function revealedVoteRoom() {
  const room = await startedVoteRoom();
  await completeVoting(room.code, CREATOR, room.items);
  await completeVoting(room.code, BOB, room.items);
  return room;
}

describe("close gate", () => {
  it("refuses to close a revealed room so results stay visible", async () => {
    const { code } = await revealedVoteRoom();

    const res = await api("POST", `/rooms/${code}/close`, {
      creatorVoterId: CREATOR.voterId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");

    const results = await getResults(code);
    expect(results.body.revealed).toBe(true);
  });
});

describe("join gate", () => {
  it("rejects joining a closed room", async () => {
    const { code } = await createRoom("vote");
    const closed = await api("POST", `/rooms/${code}/close`, {
      creatorVoterId: CREATOR.voterId,
    });
    expect(closed.status).toBe(200);

    const res = await join(code, EVE);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("rejects joining a revealed room", async () => {
    const { code } = await revealedVoteRoom();
    const res = await join(code, EVE);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("still allows joining while open and mid-vote", async () => {
    const { code } = await startedVoteRoom();
    const res = await join(code, EVE);
    expect(res.status).toBe(200);
  });
});
