import { createRouter } from "../types";
import { getRoomByCode, getItemCount } from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";
import { MLT_PROMPTS } from "../lib/mlt-prompts";
import { isParticipant, isValidName } from "../lib/participants";
import { maybeReveal, wrongModeError } from "../modes";

export const mltPrompts = createRouter();
export const mlt = createRouter();

// GET /api/mlt/prompts — Returns the curated prompt library.
mltPrompts.get("/prompts", () => {
  return Response.json({ prompts: MLT_PROMPTS });
});

// POST /api/rooms/:code/mlt-votes — Submit or update a single mlt vote.
mlt.post("/:code/mlt-votes", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { itemId, voterId, voterName, targetParticipantId } = body;

  if (!itemId || typeof itemId !== "string") {
    return validationError("itemId is required");
  }
  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!isValidName(voterName)) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (!targetParticipantId || typeof targetParticipantId !== "string") {
    return validationError("targetParticipantId is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  const wrongMode = wrongModeError(room, "mlt");
  if (wrongMode) return wrongMode;
  if (room.status !== "voting") {
    return invalidStatus("Votes can only be submitted while the room is in voting status");
  }

  if (!(await isParticipant(db, room.id, voterId))) {
    return validationError("Voter is not a participant of this room");
  }

  // Resolve the target by public participant id — clients never see voter ids.
  const target = await db
    .prepare("SELECT voter_id, voter_name FROM participants WHERE room_id = ? AND id = ?")
    .bind(room.id, targetParticipantId)
    .first<{ voter_id: string; voter_name: string }>();
  if (!target) return validationError("Target is not a participant of this room");

  // Verify the prompt (item) belongs to this room
  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return validationError("Prompt not found in this room");

  // Atomic upsert — see votes.ts; a racing duplicate must update, not 500.
  await db
    .prepare(
      `INSERT INTO mlt_votes (id, room_id, item_id, voter_id, voter_name, target_voter_id, target_voter_name) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, voter_id) DO UPDATE SET
         target_voter_id = excluded.target_voter_id,
         target_voter_name = excluded.target_voter_name,
         voter_name = excluded.voter_name`
    )
    .bind(
      crypto.randomUUID(),
      room.id,
      itemId,
      voterId,
      voterName.trim(),
      target.voter_id,
      target.voter_name
    )
    .run();

  // Progress for this voter
  const voterVotes = await db
    .prepare("SELECT COUNT(*) as count FROM mlt_votes WHERE room_id = ? AND voter_id = ?")
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
