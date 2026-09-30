import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import type { DraftOrder } from "@tot/shared";
import { purgeExpiredRooms } from "../src/lib/cleanup";
import {
  api,
  createRoom,
  join,
  start,
  getRoom,
  getResults,
  reveal,
  expectNoVoterIds,
  CREATOR,
  BOB,
  EVE,
  GHOST,
} from "./helpers";

type Player = { voterId: string; name: string };
const PLAYERS = [CREATOR, BOB, EVE];

function getDraft(code: string, voterId?: string) {
  const qs = voterId ? `?voterId=${encodeURIComponent(voterId)}` : "";
  return api("GET", `/rooms/${code}/draft${qs}`);
}

function pick(code: string, p: Player, title: string) {
  return api("POST", `/rooms/${code}/picks`, { voterId: p.voterId, voterName: p.name, title });
}

/** Create a draft room, seat `players` (host included), and start it. */
async function startedDraft(
  opts: { draftOrder?: DraftOrder; draftRounds?: number } = {},
  players: Player[] = PLAYERS
) {
  const { code, roomId } = await createRoom("draft", opts);
  for (const p of players) {
    if (p !== CREATOR) expect((await join(code, p)).status).toBe(200);
  }
  await start(code);
  return { code, roomId };
}

/** The player whose turn it is, according to the board. */
async function onTheClock(code: string): Promise<Player> {
  const board = await getDraft(code);
  expect(board.status).toBe(200);
  const player = PLAYERS.find((p) => p.name === board.body.current.name);
  expect(player).toBeDefined();
  return player!;
}

/** The player in seat 0 (seats are drawn at random). */
async function firstSeatPlayer(code: string): Promise<Player> {
  const board = await getDraft(code);
  return PLAYERS.find((p) => p.name === board.body.seats[0].name)!;
}

/** Make `count` picks in turn order, titled "<name> <n>". Returns the last response. */
async function draftPicks(code: string, count: number) {
  let last: Awaited<ReturnType<typeof pick>> | undefined;
  for (let i = 0; i < count; i++) {
    const p = await onTheClock(code);
    last = await pick(code, p, `${p.name} ${i}`);
    expect(last.status).toBe(201);
  }
  return last!;
}

async function countPicks(roomId: string, where = ""): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM draft_picks WHERE room_id = ? ${where}`
  )
    .bind(roomId)
    .first<{ c: number }>();
  return row!.c;
}

describe("draft game", () => {
  it("runs a full snake draft with three players and reveals every list", async () => {
    const { code } = await startedDraft({ draftOrder: "snake", draftRounds: 2 });

    const board = await getDraft(code, BOB.voterId);
    expect(board.body).toMatchObject({
      status: "voting",
      draftOrder: "snake",
      rounds: 2,
      totalPicks: 6,
      picks: [],
      complete: false,
    });
    expect(board.body.seats.map((s: any) => s.seat)).toEqual([0, 1, 2]);
    expect(board.body.seats.map((s: any) => s.name).sort()).toEqual(["Bob", "Cass", "Eve"]);
    expect(board.body.seats.filter((s: any) => s.isYou).map((s: any) => s.name)).toEqual(["Bob"]);
    expect(board.body.seats.find((s: any) => s.name === "Cass").isCreator).toBe(true);
    expect(board.body.current).toMatchObject({ pickIndex: 0, round: 0, seat: 0 });
    expect(board.body.current.isYou).toBe(board.body.current.name === "Bob");

    const last = await draftPicks(code, 6);
    expect(last.body).toMatchObject({
      success: true,
      pick: { pickIndex: 5, round: 1, seat: 0 },
      complete: true,
      isRevealed: true,
    });

    const done = await getDraft(code);
    expect(done.body.status).toBe("revealed");
    expect(done.body.complete).toBe(true);
    expect(done.body.current).toBeNull();
    // Snake: 0-1-2 then 2-1-0.
    expect(done.body.picks.map((p: any) => p.seat)).toEqual([0, 1, 2, 2, 1, 0]);
    expect(done.body.picks.map((p: any) => p.round)).toEqual([0, 0, 0, 1, 1, 1]);

    const results = await getResults(code, EVE.voterId);
    expect(results.status).toBe(200);
    expect(results.body).toMatchObject({
      revealed: true,
      mode: "draft",
      topic: "Test topic",
      draftOrder: "snake",
      rounds: 2,
      totalPicks: 6,
      picksMade: 6,
    });
    const players = results.body.players;
    expect(players.map((p: any) => p.seat)).toEqual([0, 1, 2]);
    for (const player of players) {
      expect(player.picks).toHaveLength(2);
      // Each list is that player's own picks, in the order they were made.
      for (const p of player.picks) expect(p.title.startsWith(player.name)).toBe(true);
      expect(player.picks.map((p: any) => p.round)).toEqual([0, 1]);
      expect(player.isYou).toBe(player.name === "Eve");
      expect(player.isCreator).toBe(player.name === "Cass");
    }
    // Seat 0 picks first and last in a snake draft.
    expect(players[0].picks.map((p: any) => p.pickIndex)).toEqual([0, 5]);
  });

  it("keeps the same direction every round in a circle draft", async () => {
    const { code } = await startedDraft({ draftOrder: "circle", draftRounds: 2 });
    await draftPicks(code, 6);

    const done = await getDraft(code);
    expect(done.body.draftOrder).toBe("circle");
    expect(done.body.picks.map((p: any) => p.seat)).toEqual([0, 1, 2, 0, 1, 2]);
    const results = await getResults(code);
    expect(results.body.players[0].picks.map((p: any) => p.pickIndex)).toEqual([0, 3]);
  });

  it("refuses a pick out of turn and names who is on the clock", async () => {
    const { code, roomId } = await startedDraft();
    const current = await onTheClock(code);
    const other = PLAYERS.find((p) => p !== current)!;

    const res = await pick(code, other, "Sneaky");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_YOUR_TURN");
    expect(res.body.error.message).toBe(`It's ${current.name}'s turn`);
    expect(await countPicks(roomId)).toBe(0);
  });

  it("refuses a duplicate that differs only by case and whitespace, without moving the turn", async () => {
    const { code } = await startedDraft();
    const first = await onTheClock(code);
    expect((await pick(code, first, "Pepperoni")).status).toBe(201);

    const second = await onTheClock(code);
    const dup = await pick(code, second, "  PEPPERONI   ");
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_PICK");
    expect(dup.body.error.message).toBe("Pepperoni has already been drafted");

    const board = await getDraft(code);
    expect(board.body.current.pickIndex).toBe(1);
    expect(board.body.current.name).toBe(second.name);

    // A different spelling is a different pick.
    expect((await pick(code, second, "Pepper  oni")).status).toBe(201);
  });

  it("stores picks trimmed and rejects bad titles", async () => {
    const { code } = await startedDraft();
    const p = await onTheClock(code);
    expect((await pick(code, p, "   ")).status).toBe(400);
    expect((await pick(code, p, "x".repeat(101))).status).toBe(400);
    const ok = await pick(code, p, "  Mushrooms ");
    expect(ok.status).toBe(201);
    expect(ok.body.pick.title).toBe("Mushrooms");
  });

  it("two simultaneous picks for the same slot leave exactly one row and never 500", async () => {
    const { code, roomId } = await startedDraft();
    const p = await onTheClock(code);

    const [a, b] = await Promise.all([pick(code, p, "Olives"), pick(code, p, "Onions")]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.error.code).toBe("NOT_YOUR_TURN");

    expect(await countPicks(roomId, "AND pick_index = 0")).toBe(1);
    expect(await countPicks(roomId)).toBe(1);
  });

  it("returns partial lists when the host force-reveals mid-draft", async () => {
    const { code } = await startedDraft({ draftRounds: 3 });
    await draftPicks(code, 4);
    await reveal(code);

    const results = await getResults(code);
    expect(results.body.revealed).toBe(true);
    expect(results.body.picksMade).toBe(4);
    expect(results.body.totalPicks).toBe(9);
    // Snake: seats 0, 1, 2, 2 have picked.
    expect(results.body.players.map((p: any) => p.picks.length)).toEqual([1, 1, 2]);

    const late = await pick(code, await firstSeatPlayer(code), "Too late");
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe("INVALID_STATUS");
  });

  it("reports progress and who is on the clock before the reveal", async () => {
    const { code } = await startedDraft({ draftRounds: 2 });
    await draftPicks(code, 2);
    const current = await onTheClock(code);

    const status = await api("GET", `/rooms/${code}/status`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      totalVoters: 3,
      completedCount: 0,
      isRevealed: false,
      picksMade: 2,
      totalPicks: 6,
    });
    expect(status.body.currentPick.name).toBe(current.name);
    expect(typeof status.body.currentPick.participantId).toBe("string");

    const pending = await getResults(code);
    expect(pending.body).toMatchObject({
      revealed: false,
      mode: "draft",
      picksMade: 2,
      totalPicks: 6,
    });

    await draftPicks(code, 4);
    const after = await api("GET", `/rooms/${code}/status`);
    expect(after.body.isRevealed).toBe(true);
    expect(after.body.completedCount).toBe(3);
    expect(after.body.currentPick).toBeNull();
  });
});

describe("draft gates", () => {
  it("refuses new players once the draft has started but lets existing ones rename", async () => {
    const { code } = await startedDraft({}, [CREATOR, BOB]);

    const late = await join(code, EVE);
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe("INVALID_STATUS");
    expect(late.body.error.message).toBe("The draft has already started");

    const rename = await join(code, { voterId: BOB.voterId, name: "Bobby" });
    expect(rename.status).toBe(200);
    const board = await getDraft(code);
    expect(board.body.seats.map((s: any) => s.name).sort()).toEqual(["Bobby", "Cass"]);

    const parts = await api("GET", `/rooms/${code}/participants`);
    expect(parts.body.participants).toHaveLength(2);
  });

  it("still lets players join and rename while the draft room is open", async () => {
    const { code } = await createRoom("draft");
    expect((await join(code, BOB)).status).toBe(200);
    expect((await join(code, { voterId: BOB.voterId, name: "Bobby" })).status).toBe(200);
    const parts = await api("GET", `/rooms/${code}/participants`);
    expect(parts.body.participants.map((p: any) => p.name)).toEqual(["Cass", "Bobby"]);
  });

  it("needs at least 2 players to start", async () => {
    const { code } = await createRoom("draft");
    const res = await api("POST", `/rooms/${code}/start`, { creatorVoterId: CREATOR.voterId });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("at least 2 players");
  });

  it("refuses the board before the start and for other modes", async () => {
    const { code } = await createRoom("draft");
    const early = await getDraft(code);
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe("INVALID_STATUS");

    const vote = await createRoom("vote");
    const wrong = await getDraft(vote.code);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("INVALID_STATUS");

    expect((await getDraft("ZZZZZZ")).status).toBe(404);
  });

  it("points picks and votes at the right endpoint for the mode", async () => {
    const vote = await createRoom("vote");
    const res = await pick(vote.code, CREATOR, "Nope");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("/votes");

    const { code } = await startedDraft({}, [CREATOR, BOB]);
    const wrong = await api("POST", `/rooms/${code}/votes`, {
      itemId: "x",
      voterId: CREATOR.voterId,
      voterName: CREATOR.name,
      vote: "yes",
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toContain("/picks");
  });

  it("rejects picks from voters who never joined", async () => {
    const { code } = await startedDraft({}, [CREATOR, BOB]);
    const res = await pick(code, GHOST, "Anchovies");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses picks before the draft starts", async () => {
    const { code } = await createRoom("draft");
    await join(code, BOB);
    const res = await pick(code, CREATOR, "Early");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("has no items", async () => {
    const { code } = await createRoom("draft");
    const add = await api("POST", `/rooms/${code}/items`, {
      items: ["Pizza"],
      creatorVoterId: CREATOR.voterId,
    });
    expect(add.status).toBe(400);
    const room = await getRoom(code, CREATOR.voterId);
    expect(room.body.items).toEqual([]);
  });
});

describe("draft settings", () => {
  it("defaults to a 5-round snake draft and returns the settings only for draft rooms", async () => {
    const { code } = await createRoom("draft");
    const room = await getRoom(code);
    expect(room.body).toMatchObject({ mode: "draft", draftOrder: "snake", draftRounds: 5 });

    const vote = await createRoom("vote", { draftOrder: "circle", draftRounds: 99 });
    const voteRoom = await getRoom(vote.code);
    expect(voteRoom.body).not.toHaveProperty("draftOrder");
    expect(voteRoom.body).not.toHaveProperty("draftRounds");
    const row = await env.DB.prepare("SELECT draft_order, draft_rounds FROM rooms WHERE id = ?")
      .bind(vote.roomId)
      .first();
    expect(row).toEqual({ draft_order: null, draft_rounds: null });
  });

  it("stores the settings chosen at creation", async () => {
    const { code } = await createRoom("draft", { draftOrder: "circle", draftRounds: 10 });
    const room = await getRoom(code);
    expect(room.body).toMatchObject({ draftOrder: "circle", draftRounds: 10 });
  });

  it("rejects out-of-range rounds and unknown orders on create", async () => {
    const bad = [
      { draftRounds: 0 },
      { draftRounds: 11 },
      { draftRounds: 2.5 },
      { draftOrder: "x" },
    ];
    for (const settings of bad) {
      const res = await api("POST", "/rooms", {
        topic: "Toppings",
        creatorVoterId: CREATOR.voterId,
        creatorName: CREATOR.name,
        mode: "draft",
        ...settings,
      });
      expect(res.status, JSON.stringify(settings)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("updates settings individually while open and echoes them", async () => {
    const { code } = await createRoom("draft");
    const patch = (body: object) =>
      api("PATCH", `/rooms/${code}/settings`, { creatorVoterId: CREATOR.voterId, ...body });

    const order = await patch({ draftOrder: "circle" });
    expect(order.status).toBe(200);
    expect(order.body).toEqual({
      success: true,
      allowSuggestions: false,
      draftOrder: "circle",
      draftRounds: 5,
    });

    const rounds = await patch({ draftRounds: 3 });
    expect(rounds.body).toMatchObject({ draftOrder: "circle", draftRounds: 3 });
    expect((await getRoom(code)).body).toMatchObject({ draftOrder: "circle", draftRounds: 3 });

    for (const bad of [{ draftRounds: 0 }, { draftRounds: 11 }, { draftOrder: "x" }, {}]) {
      const res = await patch(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    // Suggestions aren't a draft feature.
    expect((await patch({ allowSuggestions: true })).status).toBe(400);

    await join(code, BOB);
    await start(code);
    const locked = await patch({ draftRounds: 1 });
    expect(locked.status).toBe(400);
    expect(locked.body.error.code).toBe("INVALID_STATUS");
    expect((await getDraft(code)).body.rounds).toBe(3);
  });

  it("refuses draft settings in other modes but keeps allowSuggestions working", async () => {
    const { code } = await createRoom("vote");
    const draft = await api("PATCH", `/rooms/${code}/settings`, {
      creatorVoterId: CREATOR.voterId,
      draftRounds: 3,
    });
    expect(draft.status).toBe(400);
    expect(draft.body.error.code).toBe("INVALID_STATUS");

    const ok = await api("PATCH", `/rooms/${code}/settings`, {
      creatorVoterId: CREATOR.voterId,
      allowSuggestions: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, allowSuggestions: true });
  });
});

describe("draft privacy", () => {
  it("never puts a voter id in the board, status, results or room", async () => {
    const { code } = await startedDraft({ draftRounds: 1 });
    await draftPicks(code, 1);

    for (const voterId of [undefined, CREATOR.voterId, BOB.voterId]) {
      expectNoVoterIds((await getDraft(code, voterId)).body);
      expectNoVoterIds((await getRoom(code, voterId)).body);
      expectNoVoterIds((await getResults(code, voterId)).body);
    }
    expectNoVoterIds((await api("GET", `/rooms/${code}/status`)).body);

    await draftPicks(code, 2);
    for (const voterId of [undefined, CREATOR.voterId]) {
      const results = await getResults(code, voterId);
      expect(results.body.revealed).toBe(true);
      for (const player of results.body.players) {
        expect(player).not.toHaveProperty("voterId");
      }
      expectNoVoterIds(results.body);
      expectNoVoterIds((await getDraft(code, voterId)).body);
    }
    expectNoVoterIds((await api("GET", `/rooms/${code}/status`)).body);
  });
});

describe("draft cleanup", () => {
  it("deletes an expired draft's seats and picks with the room", async () => {
    const { code, roomId } = await startedDraft({}, [CREATOR, BOB]);
    await draftPicks(code, 2);

    await env.DB.prepare("UPDATE rooms SET expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), roomId)
      .run();
    await purgeExpiredRooms(env.DB, new Date().toISOString());

    for (const table of ["rooms", "draft_seats", "draft_picks", "participants"]) {
      const column = table === "rooms" ? "id" : "room_id";
      const row = await env.DB.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE ${column} = ?`)
        .bind(roomId)
        .first<{ n: number }>();
      expect(row!.n, table).toBe(0);
    }
  });
});
