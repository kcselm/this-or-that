import { createRouter } from "../types";
import { getRoomByCode, getItemCount } from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";

export const votes = createRouter();

// POST /api/rooms/:code/votes — Submit a single vote
votes.post("/:code/votes", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { itemId, voterId, voterName, vote } = body;

  if (!itemId || typeof itemId !== "string") {
    return validationError("itemId is required");
  }
  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (vote !== "yes" && vote !== "no") {
    return validationError("vote must be 'yes' or 'no'");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.status !== "voting") return invalidStatus("Votes can only be submitted while the room is in voting status");

  // Verify item belongs to this room
  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return validationError("Item not found in this room");

  // Upsert: insert or update existing vote
  const existing = await db
    .prepare("SELECT id FROM votes WHERE item_id = ? AND voter_id = ?")
    .bind(itemId, voterId)
    .first();

  if (existing) {
    await db
      .prepare("UPDATE votes SET vote = ?, voter_name = ? WHERE id = ?")
      .bind(vote, voterName.trim(), existing.id as string)
      .run();
  } else {
    const voteId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO votes (id, room_id, item_id, voter_id, voter_name, vote) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(voteId, room.id, itemId, voterId, voterName.trim(), vote)
      .run();
  }

  // Get progress for this voter
  const voterVotes = await db
    .prepare("SELECT COUNT(*) as count FROM votes WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first<{ count: number }>();
  const totalItems = await getItemCount(db, room.id);

  const voted = voterVotes?.count ?? 0;

  // Auto-reveal: check if all voters have completed
  if (voted === totalItems) {
    await maybeReveal(db, room.id, totalItems);
  }

  return Response.json(
    { success: true, progress: { voted, total: totalItems } },
    { status: 201 }
  );
});

async function maybeReveal(
  db: D1Database,
  roomId: string,
  totalItems: number
) {
  // Count registered participants (everyone who joined the room)
  const participantCount = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();

  const completed = await db
    .prepare(
      `SELECT COUNT(*) as completed FROM (
        SELECT voter_id FROM votes WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= ?
      )`
    )
    .bind(roomId, totalItems)
    .first<{ completed: number }>();

  // Auto-reveal when ALL participants have finished voting
  const totalParticipants = participantCount?.count ?? 0;
  const completedCount = completed?.completed ?? 0;
  if (totalParticipants >= 2 && completedCount >= totalParticipants) {
    await db
      .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
      .bind(roomId)
      .run();
  }
}
