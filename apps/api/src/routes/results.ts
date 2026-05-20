import { createRouter } from "../types";
import { getRoomByCode, getItemsByRoomId, getItemCount, getRankingsByRoom, type Room } from "../db/queries";
import { notFound, notCreator, invalidStatus, validationError } from "../lib/validation";

export const results = createRouter();

// GET /api/rooms/:code/status — Check voting progress
results.get("/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const totalItems = await getItemCount(db, room.id);

  const submissionsTable = room.mode === "rank" ? "rankings" : "votes";
  const requiredCount = room.mode === "rank" ? 5 : totalItems;

  const { results: participantRows } = await db
    .prepare(
      `SELECT p.voter_id, p.voter_name, COALESCE(s.submission_count, 0) as submission_count
       FROM participants p
       LEFT JOIN (
         SELECT voter_id, COUNT(*) as submission_count
         FROM ${submissionsTable} WHERE room_id = ?
         GROUP BY voter_id
       ) s ON p.voter_id = s.voter_id
       WHERE p.room_id = ?`
    )
    .bind(room.id, room.id)
    .all<{ voter_id: string; voter_name: string; submission_count: number }>();

  const voters = participantRows.map((row) => ({
    name: row.voter_name,
    completed: row.submission_count >= requiredCount,
  }));

  const completedCount = voters.filter((v) => v.completed).length;

  const totalVoters = voters.length;

  return Response.json({
    totalVoters,
    completedCount,
    isRevealed: room.status === "revealed",
    voters,
  });
});

// GET /api/rooms/:code/results — Get final results
results.get("/:code/results", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  if (room.mode === "rank") {
    return getRankResults(c, db, room, voterId);
  }
  return getVoteResults(c, db, room);
});

async function getVoteResults(c: any, db: D1Database, room: Room) {
  if (room.status !== "revealed") {
    // Return progress instead
    const totalItems = await getItemCount(db, room.id);
    const result = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT voter_id FROM votes WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= ?
        )`
      )
      .bind(room.id, totalItems)
      .first<{ completed: number }>();

    const totalVoters = await db
      .prepare("SELECT COUNT(DISTINCT voter_id) as count FROM votes WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();

    return Response.json({
      revealed: false,
      completedCount: result?.completed ?? 0,
      totalVoters: totalVoters?.count ?? 0,
    });
  }

  // Get items with vote tallies
  const items = await getItemsByRoomId(db, room.id);
  const { results: voteTallies } = await db
    .prepare(
      `SELECT item_id,
              SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) as yes_count,
              SUM(CASE WHEN vote = 'no' THEN 1 ELSE 0 END) as no_count
       FROM votes WHERE room_id = ? GROUP BY item_id`
    )
    .bind(room.id)
    .all<{ item_id: string; yes_count: number; no_count: number }>();

  const tallyMap = new Map(voteTallies.map((t) => [t.item_id, t]));

  // Count total voters
  const voterCount = await db
    .prepare("SELECT COUNT(DISTINCT voter_id) as count FROM votes WHERE room_id = ?")
    .bind(room.id)
    .first<{ count: number }>();

  const resultsData = items
    .map((item) => {
      const tally = tallyMap.get(item.id);
      const yesCount = tally?.yes_count ?? 0;
      const noCount = tally?.no_count ?? 0;
      const total = yesCount + noCount;
      return {
        itemId: item.id,
        title: item.title,
        yesCount,
        noCount,
        yesPercentage: total > 0 ? Math.round((yesCount / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.yesPercentage - a.yesPercentage);

  return Response.json({
    revealed: true,
    topic: room.topic,
    totalVoters: voterCount?.count ?? 0,
    results: resultsData,
  });
}

async function getRankResults(
  c: any,
  db: D1Database,
  room: Room,
  voterId: string | undefined
) {
  if (room.status !== "revealed") {
    const totalParticipants = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();
    const completed = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT voter_id FROM rankings WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= 5
        )`
      )
      .bind(room.id)
      .first<{ completed: number }>();

    return Response.json({
      revealed: false,
      mode: "rank",
      completedCount: completed?.completed ?? 0,
      totalVoters: totalParticipants?.count ?? 0,
    });
  }

  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const allRankings = await getRankingsByRoom(db, room.id);

  const participants = await db
    .prepare(
      "SELECT voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string }>();

  type PlayerRow = {
    voterId: string;
    name: string;
    isCreator: boolean;
    rankings: { rank: number; itemId: string; title: string }[];
  };

  const byVoter = new Map<string, PlayerRow>();
  for (const p of participants.results) {
    byVoter.set(p.voter_id, {
      voterId: p.voter_id,
      name: p.voter_name,
      isCreator: p.voter_id === room.creator_voter_id,
      rankings: [],
    });
  }
  for (const r of allRankings) {
    const row = byVoter.get(r.voter_id);
    if (!row) continue;
    row.rankings.push({
      rank: r.rank,
      itemId: r.item_id,
      title: titleById.get(r.item_id) ?? "",
    });
  }

  const players: PlayerRow[] = [];
  for (const row of byVoter.values()) {
    if (row.rankings.length === 5) {
      row.rankings.sort((a, b) => a.rank - b.rank);
      players.push(row);
    }
  }

  players.sort((a, b) => {
    if (voterId && a.voterId === voterId) return -1;
    if (voterId && b.voterId === voterId) return 1;
    if (a.isCreator && !b.isCreator) return -1;
    if (b.isCreator && !a.isCreator) return 1;
    return a.name.localeCompare(b.name);
  });

  return Response.json({
    revealed: true,
    mode: "rank",
    topic: room.topic,
    players,
  });
}

// POST /api/rooms/:code/reveal — Creator force-reveals results
results.post("/:code/reveal", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { creatorVoterId } = body;

  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.status !== "voting") return invalidStatus("Room must be in voting status to reveal");

  await db
    .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ?")
    .bind(room.id)
    .run();

  return Response.json({ success: true, status: "revealed" });
});
