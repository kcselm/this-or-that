import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { PURGE_BATCH_SIZE, purgeAllExpiredRooms, purgeExpiredRooms } from "../src/lib/cleanup";
import {
  api,
  createRoom,
  addItems,
  join,
  start,
  getRoom,
  startedVoteRoom,
  completeVoting,
  BOB,
  EVE,
  CREATOR,
} from "./helpers";

const CHILD_TABLES = [
  "items",
  "participants",
  "votes",
  "rankings",
  "matchups",
  "matchup_votes",
  "mlt_votes",
  "tier_placements",
  "draft_seats",
  "draft_picks",
];

async function expire(roomId: string, msAgo = 60_000) {
  await env.DB.prepare("UPDATE rooms SET expires_at = ? WHERE id = ?")
    .bind(new Date(Date.now() - msAgo).toISOString(), roomId)
    .run();
}

async function rowCounts(roomId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ["rooms", ...CHILD_TABLES]) {
    const column = table === "rooms" ? "id" : "room_id";
    const row = await env.DB.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE ${column} = ?`)
      .bind(roomId)
      .first<{ n: number }>();
    counts[table] = row!.n;
  }
  return counts;
}

describe("room expiry", () => {
  it("treats a room as gone the moment expires_at passes, not at the end of that day", async () => {
    const { code, roomId } = await createRoom("vote");
    expect((await getRoom(code)).status).toBe(200);

    await expire(roomId);

    const res = await getRoom(code);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("new rooms expire 48 hours after creation", async () => {
    const before = Date.now();
    const res = await api("POST", "/rooms", {
      topic: "Expiry",
      creatorVoterId: CREATOR.voterId,
      creatorName: CREATOR.name,
    });
    expect(res.status).toBe(201);
    const ttl = Date.parse(res.body.expiresAt) - before;
    expect(ttl).toBeGreaterThanOrEqual(48 * 3600 * 1000 - 1000);
    expect(ttl).toBeLessThanOrEqual(48 * 3600 * 1000 + 5000);
  });
});

describe("purgeExpiredRooms", () => {
  it("deletes an expired room and every row that belongs to it", async () => {
    const { code, roomId, items } = await startedVoteRoom(["Pizza", "Sushi"], [BOB]);
    await completeVoting(code, CREATOR, items);

    const before = await rowCounts(roomId);
    expect(before.rooms).toBe(1);
    expect(before.votes).toBe(2);

    await expire(roomId);
    const deleted = await purgeExpiredRooms(env.DB, new Date().toISOString());
    expect(deleted).toBeGreaterThanOrEqual(1);

    const after = await rowCounts(roomId);
    for (const [table, n] of Object.entries(after)) {
      expect(n, table).toBe(0);
    }
  });

  it("clears bracket matchups and votes without tripping foreign keys", async () => {
    const { code, roomId } = await createRoom("bracket");
    await addItems(code, ["A", "B", "C", "D"]);
    await join(code, BOB);
    await start(code);

    const bracket = await api("GET", `/rooms/${code}/bracket?voterId=${CREATOR.voterId}`);
    const matchup = bracket.body.rounds[0].matchups[0];
    const vote = await api("POST", `/rooms/${code}/matchup-votes`, {
      matchupId: matchup.id,
      voterId: CREATOR.voterId,
      voterName: CREATOR.name,
      pickedItemId: matchup.itemA.id,
    });
    expect(vote.status).toBe(201);

    await expire(roomId);
    await purgeExpiredRooms(env.DB, new Date().toISOString());

    const after = await rowCounts(roomId);
    expect(after.matchups).toBe(0);
    expect(after.matchup_votes).toBe(0);
    expect(after.rooms).toBe(0);
  });

  it("leaves rooms that haven't expired alone", async () => {
    const { code, roomId } = await createRoom("vote");
    await join(code, EVE);

    await purgeExpiredRooms(env.DB, new Date().toISOString());

    const after = await rowCounts(roomId);
    expect(after.rooms).toBe(1);
    expect(after.participants).toBe(2);
    expect((await getRoom(code)).status).toBe(200);
  });

  it("clears a backlog bigger than one batch in a single run", async () => {
    const count = PURGE_BATCH_SIZE + 50;
    const past = new Date(Date.now() - 60_000).toISOString();
    const insert = env.DB.prepare(
      "INSERT INTO rooms (id, code, topic, creator_voter_id, expires_at) VALUES (?, ?, 'Old', 'nobody', ?)"
    );
    await env.DB.batch(
      Array.from({ length: count }, (_, i) =>
        insert.bind(`backlog-${i}`, `BL${String(i).padStart(4, "0")}`, past)
      )
    );

    const deleted = await purgeAllExpiredRooms(env.DB, new Date().toISOString());
    expect(deleted).toBeGreaterThanOrEqual(count);

    const left = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM rooms WHERE id LIKE 'backlog-%'"
    ).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
