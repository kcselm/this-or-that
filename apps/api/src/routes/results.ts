import { createRouter } from "../types";
import { getRoomByCode, getItemsByRoomId, getItemCount } from "../db/queries";
import { notFound, notCreator, invalidStatus, validationError } from "../lib/validation";

export const results = createRouter();

// GET /api/rooms/:code/status — Check voting progress
results.get("/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const totalItems = await getItemCount(db, room.id);

  // Get all registered participants
  const { results: participantRows } = await db
    .prepare(
      `SELECT p.voter_id, p.voter_name, COALESCE(v.vote_count, 0) as vote_count
       FROM participants p
       LEFT JOIN (
         SELECT voter_id, COUNT(*) as vote_count
         FROM votes WHERE room_id = ?
         GROUP BY voter_id
       ) v ON p.voter_id = v.voter_id
       WHERE p.room_id = ?`
    )
    .bind(room.id, room.id)
    .all<{ voter_id: string; voter_name: string; vote_count: number }>();

  const voters = participantRows.map((row) => ({
    name: row.voter_name,
    completed: row.vote_count >= totalItems,
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

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

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
});

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
