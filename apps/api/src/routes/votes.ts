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
  if (room.mode === "rank") {
    return validationError("This is a blind rank room — use /rankings instead of /votes");
  }
  if (room.mode === "bracket") {
    return validationError("This is a bracket room — use /matchup-votes instead of /votes");
  }
  if (room.mode === "mlt") {
    return validationError("This is a Most Likely To room — use /mlt-votes instead of /votes");
  }
  if (room.mode === "tier") {
    return validationError("This is a tier list room — use /tiers instead of /votes");
  }

  // Verify the voter is a participant of this room
  const participant = await db
    .prepare("SELECT id FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first();
  if (!participant) return validationError("You must join the room before voting");

  // Verify item belongs to this room
  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return validationError("Item not found in this room");

  // Atomic upsert. A SELECT-then-INSERT races when two submissions for the
  // same (item, voter) interleave — the loser dies on UNIQUE with a 500.
  await db
    .prepare(
      `INSERT INTO votes (id, room_id, item_id, voter_id, voter_name, vote) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, voter_id) DO UPDATE SET vote = excluded.vote, voter_name = excluded.voter_name`
    )
    .bind(crypto.randomUUID(), room.id, itemId, voterId, voterName.trim(), vote)
    .run();

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

  // Only registered participants count toward completion — stray vote rows
  // from non-participants must not trigger an early reveal.
  const completed = await db
    .prepare(
      `SELECT COUNT(*) as completed FROM (
        SELECT v.voter_id FROM votes v
        JOIN participants p ON p.room_id = v.room_id AND p.voter_id = v.voter_id
        WHERE v.room_id = ? GROUP BY v.voter_id HAVING COUNT(*) >= ?
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
