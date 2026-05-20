import { createRouter } from "../types";
import {
  getRoomByCode,
  getNextRankItem,
  getRankingsByRoomAndVoter,
} from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";

export const rankings = createRouter();

// GET /api/rooms/:code/next-item?voterId=X — Server-enforced "blind" item delivery.
rankings.get("/:code/next-item", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  if (!voterId) {
    return validationError("voterId query param is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "rank") return invalidStatus("This room is not a blind rank room");
  if (room.status !== "voting") return invalidStatus("Room is not in voting status");

  const item = await getNextRankItem(db, room.id, voterId);
  const placed = (await getRankingsByRoomAndVoter(db, room.id, voterId)).length;

  return Response.json({
    item: item ? { id: item.id, title: item.title } : null,
    progress: { placed, total: 5 },
  });
});

// POST /api/rooms/:code/rankings — Submit a single placement.
rankings.post("/:code/rankings", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { itemId, voterId, voterName, rank } = body;

  if (!itemId || typeof itemId !== "string") {
    return validationError("itemId is required");
  }
  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 5) {
    return validationError("rank must be an integer 1-5");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "rank") {
    return validationError("This room is not a blind rank room");
  }
  if (room.status !== "voting") {
    return invalidStatus("Rankings can only be submitted while voting is open");
  }

  // Verify item belongs to this room.
  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return validationError("Item not found in this room");

  // Insert ranking. UNIQUE constraints catch duplicate item or duplicate rank.
  try {
    const rankingId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO rankings (id, room_id, item_id, voter_id, voter_name, rank) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(rankingId, room.id, itemId, voterId, voterName.trim(), rank)
      .run();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE")) {
      return validationError(
        "You have already placed this item or filled this slot — placements are locked"
      );
    }
    throw e;
  }

  // Progress
  const placedRow = await db
    .prepare("SELECT COUNT(*) as count FROM rankings WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first<{ count: number }>();
  const placed = placedRow?.count ?? 0;

  // Auto-reveal when all participants have all 5 rankings.
  if (placed === 5) {
    await maybeRevealRank(db, room.id);
  }

  return Response.json(
    { success: true, progress: { placed, total: 5 } },
    { status: 201 }
  );
});

async function maybeRevealRank(db: D1Database, roomId: string) {
  const participantCount = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();

  const completed = await db
    .prepare(
      `SELECT COUNT(*) as completed FROM (
        SELECT voter_id FROM rankings WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= 5
      )`
    )
    .bind(roomId)
    .first<{ completed: number }>();

  const totalParticipants = participantCount?.count ?? 0;
  const completedCount = completed?.completed ?? 0;
  if (totalParticipants >= 2 && completedCount >= totalParticipants) {
    await db
      .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
      .bind(roomId)
      .run();
  }
}
