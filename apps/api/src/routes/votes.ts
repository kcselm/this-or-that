import { createRouter } from "../types";
import { getRoomByCode, getItemCount } from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";
import { isParticipant, isValidName } from "../lib/participants";
import { maybeReveal, wrongModeError } from "../modes";

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
  if (!isValidName(voterName)) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (vote !== "yes" && vote !== "no") {
    return validationError("vote must be 'yes' or 'no'");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.status !== "voting")
    return invalidStatus("Votes can only be submitted while the room is in voting status");
  const wrongMode = wrongModeError(room, "vote");
  if (wrongMode) return wrongMode;

  if (!(await isParticipant(db, room.id, voterId))) {
    return validationError("You must join the room before voting");
  }

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

  // This voter just finished — they may have been the last one.
  if (voted === totalItems) {
    await maybeReveal(db, room);
  }

  return Response.json({ success: true, progress: { voted, total: totalItems } }, { status: 201 });
});
