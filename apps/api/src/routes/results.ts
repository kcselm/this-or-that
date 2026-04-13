import { createRouter } from "../types";
import { getRoomByCode, getItemsByRoomId, getItemCount } from "../db/queries";
import { notFound } from "../lib/validation";

export const results = createRouter();

// GET /api/rooms/:code/status — Check voting progress
results.get("/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const totalItems = await getItemCount(db, room.id);

  // Get all voters and their vote counts
  const { results: voterRows } = await db
    .prepare(
      `SELECT voter_id, voter_name, COUNT(*) as vote_count
       FROM votes WHERE room_id = ? GROUP BY voter_id`
    )
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string; vote_count: number }>();

  const voters = voterRows.map((row) => ({
    name: row.voter_name,
    completed: row.vote_count >= totalItems,
  }));

  const completedCount = voters.filter((v) => v.completed).length;

  return Response.json({
    expectedCount: room.expected_count,
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

    return Response.json({
      revealed: false,
      completedCount: result?.completed ?? 0,
      expectedCount: room.expected_count,
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
