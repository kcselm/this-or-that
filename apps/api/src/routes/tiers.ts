import { createRouter } from "../types";
import { getRoomByCode, getItemsByRoomId } from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";

export const tiers = createRouter();

const VALID_TIERS = new Set(["S", "A", "B", "C", "D"]);

// POST /api/rooms/:code/tiers — Submit a full tier board in one shot (lock-in).
tiers.post("/:code/tiers", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { voterId, voterName, placements } = body;

  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (!Array.isArray(placements) || placements.length < 1) {
    return validationError("placements must be a non-empty array");
  }
  for (const p of placements) {
    if (!p || typeof p.itemId !== "string" || typeof p.tier !== "string" || !VALID_TIERS.has(p.tier)) {
      return validationError("Each placement needs an itemId and a tier of S, A, B, C, or D");
    }
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "tier") {
    return validationError("This endpoint is only for tier list rooms");
  }
  if (room.status !== "voting") {
    return invalidStatus("Boards can only be submitted while the room is in voting status");
  }

  // Verify the voter is a participant of this room.
  const voter = await db
    .prepare("SELECT voter_id FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first();
  if (!voter) return validationError("You must join the room before submitting a board");

  // The board must place every item in the room exactly once.
  const items = await getItemsByRoomId(db, room.id);
  const itemIds = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  for (const p of placements) {
    if (!itemIds.has(p.itemId)) {
      return validationError("Placement references an item that is not in this room");
    }
    if (seen.has(p.itemId)) {
      return validationError("Each item can only be placed once");
    }
    seen.add(p.itemId);
  }
  if (seen.size !== items.length) {
    return validationError(`You must place all ${items.length} items before locking in`);
  }

  // Insert all placements atomically. UNIQUE(item_id, voter_id) catches a
  // double lock-in (whole batch fails).
  const statements = placements.map((p: { itemId: string; tier: string }) =>
    db
      .prepare(
        "INSERT INTO tier_placements (id, room_id, item_id, voter_id, voter_name, tier) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), room.id, p.itemId, voterId, voterName.trim(), p.tier)
  );

  try {
    await db.batch(statements);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE")) {
      return validationError("You have already locked in your board");
    }
    throw e;
  }

  const total = items.length;
  const isRevealed = await maybeRevealTier(db, room.id, total);

  return Response.json(
    { success: true, progress: { placed: total, total }, isRevealed },
    { status: 201 }
  );
});

async function maybeRevealTier(
  db: D1Database,
  roomId: string,
  totalItems: number
): Promise<boolean> {
  const participantCount = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();

  const completed = await db
    .prepare(
      `SELECT COUNT(*) as completed FROM (
        SELECT voter_id FROM tier_placements WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= ?
      )`
    )
    .bind(roomId, totalItems)
    .first<{ completed: number }>();

  const totalParticipants = participantCount?.count ?? 0;
  const completedCount = completed?.completed ?? 0;
  if (totalParticipants >= 2 && completedCount >= totalParticipants) {
    await db
      .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
      .bind(roomId)
      .run();
    return true;
  }
  return false;
}
