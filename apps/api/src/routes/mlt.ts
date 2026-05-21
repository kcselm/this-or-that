import { createRouter } from "../types";
import {
  getRoomByCode,
  getItemCount,
} from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";
import { MLT_PROMPTS } from "../lib/mlt-prompts";

export const mlt = createRouter();

// GET /api/mlt/prompts — Returns the curated prompt library.
// Note: this is mounted at /api (not /api/rooms) — see index.ts.
mlt.get("/prompts", (c) => {
  return Response.json({ prompts: MLT_PROMPTS });
});

// POST /api/rooms/:code/mlt-votes — Submit or update a single mlt vote.
mlt.post("/:code/mlt-votes", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { itemId, voterId, voterName, targetVoterId } = body;

  if (!itemId || typeof itemId !== "string") {
    return validationError("itemId is required");
  }
  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (!targetVoterId || typeof targetVoterId !== "string") {
    return validationError("targetVoterId is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "mlt") {
    return validationError("This endpoint is only for Most Likely To rooms");
  }
  if (room.status !== "voting") {
    return invalidStatus("Votes can only be submitted while the room is in voting status");
  }

  // Verify the voter is a participant
  const voter = await db
    .prepare("SELECT voter_id, voter_name FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first<{ voter_id: string; voter_name: string }>();
  if (!voter) return validationError("Voter is not a participant of this room");

  // Verify the target is also a participant — and grab their current name
  const target = await db
    .prepare("SELECT voter_id, voter_name FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, targetVoterId)
    .first<{ voter_id: string; voter_name: string }>();
  if (!target) return validationError("Target is not a participant of this room");

  // Verify the prompt (item) belongs to this room
  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return validationError("Prompt not found in this room");

  // Upsert: insert or update existing vote
  const existing = await db
    .prepare("SELECT id FROM mlt_votes WHERE item_id = ? AND voter_id = ?")
    .bind(itemId, voterId)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        "UPDATE mlt_votes SET target_voter_id = ?, target_voter_name = ?, voter_name = ? WHERE id = ?"
      )
      .bind(targetVoterId, target.voter_name, voterName.trim(), existing.id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO mlt_votes (id, room_id, item_id, voter_id, voter_name, target_voter_id, target_voter_name) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        room.id,
        itemId,
        voterId,
        voterName.trim(),
        targetVoterId,
        target.voter_name
      )
      .run();
  }

  // Progress for this voter
  const voterVotes = await db
    .prepare("SELECT COUNT(*) as count FROM mlt_votes WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first<{ count: number }>();
  const totalItems = await getItemCount(db, room.id);
  const voted = voterVotes?.count ?? 0;

  // Auto-reveal: when every participant has voted on every prompt.
  if (voted === totalItems) {
    await maybeReveal(db, room.id, totalItems);
  }

  return Response.json(
    { success: true, progress: { voted, total: totalItems } },
    { status: 201 }
  );
});

async function maybeReveal(db: D1Database, roomId: string, totalItems: number) {
  const participantCount = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();

  const completed = await db
    .prepare(
      `SELECT COUNT(*) as completed FROM (
        SELECT voter_id FROM mlt_votes WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= ?
      )`
    )
    .bind(roomId, totalItems)
    .first<{ completed: number }>();

  if ((completed?.completed ?? 0) >= (participantCount?.count ?? 0)) {
    await db
      .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
      .bind(roomId)
      .run();
  }
}
