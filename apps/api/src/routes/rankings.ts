import { RANK_SLOTS } from "@tot/shared";
import { createRouter } from "../types";
import {
  getRoomByCode,
  getNextRankItem,
  getRankingsByRoomAndVoter,
} from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";
import { isParticipant, isValidName } from "../lib/participants";
import { maybeReveal, wrongModeError } from "../modes";

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

  if (!(await isParticipant(db, room.id, voterId))) {
    return validationError("You must join the room before playing");
  }

  const item = await getNextRankItem(db, room.id, voterId);
  const placed = (await getRankingsByRoomAndVoter(db, room.id, voterId)).length;

  return Response.json({
    item: item ? { id: item.id, title: item.title } : null,
    progress: { placed, total: RANK_SLOTS },
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
  if (!isValidName(voterName)) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > RANK_SLOTS) {
    return validationError(`rank must be an integer 1-${RANK_SLOTS}`);
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  const wrongMode = wrongModeError(room, "rank");
  if (wrongMode) return wrongMode;
  if (room.status !== "voting") {
    return invalidStatus("Rankings can only be submitted while voting is open");
  }

  if (!(await isParticipant(db, room.id, voterId))) {
    return validationError("You must join the room before playing");
  }

  // Verify item belongs to this room.
  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return validationError("Item not found in this room");

  // Insert ranking. UNIQUE constraints catch duplicate item or duplicate rank.
  try {
    await db
      .prepare(
        "INSERT INTO rankings (id, room_id, item_id, voter_id, voter_name, rank) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), room.id, itemId, voterId, voterName.trim(), rank)
      .run();
  } catch (e: unknown) {
    if (String((e as Error)?.message ?? e).includes("UNIQUE")) {
      return validationError(
        "You have already placed this item or filled this slot — placements are locked"
      );
    }
    throw e;
  }

  const placedRow = await db
    .prepare("SELECT COUNT(*) as count FROM rankings WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first<{ count: number }>();
  const placed = placedRow?.count ?? 0;

  // This player just filled their board — they may have been the last one.
  if (placed === RANK_SLOTS) {
    await maybeReveal(db, room);
  }

  return Response.json(
    { success: true, progress: { placed, total: RANK_SLOTS } },
    { status: 201 }
  );
});
