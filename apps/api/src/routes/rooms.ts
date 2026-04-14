import { createRouter } from "../types";
import { generateCode } from "../lib/codes";
import { getRoomByCode, getItemsByRoomId, getItemCount, getVotesByRoomAndVoter } from "../db/queries";
import { notFound, notCreator, invalidStatus, validationError } from "../lib/validation";

export const rooms = createRouter();

// POST /api/rooms — Create a new room
rooms.post("/", async (c) => {
  const body = await c.req.json();
  const { topic, creatorVoterId, creatorName } = body;

  if (!topic || typeof topic !== "string" || topic.length < 1 || topic.length > 100) {
    return validationError("Topic is required and must be 1-100 characters");
  }
  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }
  if (!creatorName || typeof creatorName !== "string" || creatorName.length < 1 || creatorName.length > 30) {
    return validationError("Creator name is required and must be 1-30 characters");
  }

  const db = c.env.DB;
  const id = crypto.randomUUID();

  // Generate a unique code
  let code: string;
  for (let attempts = 0; ; attempts++) {
    if (attempts >= 10) {
      return Response.json({ error: { code: "INTERNAL_ERROR", message: "Failed to generate unique code" } }, { status: 500 });
    }
    code = generateCode();
    const existing = await db
      .prepare("SELECT id FROM rooms WHERE code = ? AND expires_at > datetime('now')")
      .bind(code)
      .first();
    if (!existing) break;
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      "INSERT INTO rooms (id, code, topic, creator_voter_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'open', ?, ?)"
    )
    .bind(id, code!, topic.trim(), creatorVoterId, now, expiresAt)
    .run();

  // Auto-join the creator as a participant
  await db
    .prepare("INSERT INTO participants (id, room_id, voter_id, voter_name) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), id, creatorVoterId, creatorName.trim())
    .run();

  return Response.json(
    { id, code: code!, topic: topic.trim(), createdAt: now, expiresAt },
    { status: 201 }
  );
});

// POST /api/rooms/:code/items — Add items to a room
rooms.post("/:code/items", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { items, creatorVoterId } = body;

  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 15) {
    return validationError("Items must be an array of 1-15 strings");
  }
  for (const item of items) {
    if (typeof item !== "string" || item.trim().length < 1 || item.trim().length > 100) {
      return validationError("Each item must be a string of 1-100 characters");
    }
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.status !== "open") return invalidStatus("Items can only be added while the room is open");

  const currentCount = await getItemCount(db, room.id);
  if (currentCount + items.length > 15) {
    return validationError(`Adding ${items.length} items would exceed the limit of 15 (currently ${currentCount})`);
  }

  const newItems = [];
  for (let i = 0; i < items.length; i++) {
    const itemId = crypto.randomUUID();
    const sortOrder = currentCount + i;
    await db
      .prepare("INSERT INTO items (id, room_id, title, sort_order) VALUES (?, ?, ?, ?)")
      .bind(itemId, room.id, items[i].trim(), sortOrder)
      .run();
    newItems.push({ id: itemId, title: items[i].trim(), sortOrder });
  }

  return Response.json(
    { items: newItems, totalItems: currentCount + items.length },
    { status: 201 }
  );
});

// DELETE /api/rooms/:code/items/:itemId — Delete an item
rooms.delete("/:code/items/:itemId", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const itemId = c.req.param("itemId");
  const creatorVoterId = c.req.query("creatorVoterId");

  if (!creatorVoterId) {
    return validationError("creatorVoterId query param is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.status !== "open") return invalidStatus("Items can only be deleted while the room is open");

  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return notFound();

  await db.prepare("DELETE FROM items WHERE id = ?").bind(itemId).run();

  const totalItems = await getItemCount(db, room.id);
  return Response.json({ success: true, totalItems });
});

// POST /api/rooms/:code/start — Start voting
rooms.post("/:code/start", async (c) => {
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
  if (room.status !== "open") return invalidStatus("Room has already started voting");

  const itemCount = await getItemCount(db, room.id);
  if (itemCount < 2) {
    return validationError("Room must have at least 2 items to start voting");
  }

  await db
    .prepare("UPDATE rooms SET status = 'voting' WHERE id = ?")
    .bind(room.id)
    .run();

  return Response.json({ success: true, status: "voting", itemCount });
});

// GET /api/rooms/:code — Get room details
rooms.get("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  // In open status, only the creator sees items
  let items: { id: string; title: string }[] = [];
  if (room.status !== "open" || (voterId && voterId === room.creator_voter_id)) {
    const allItems = await getItemsByRoomId(db, room.id);
    items = allItems.map((item) => ({ id: item.id, title: item.title }));
  }

  const response: Record<string, unknown> = {
    id: room.id,
    code: room.code,
    topic: room.topic,
    status: room.status,
    items,
  };

  if (voterId) {
    const votes = await getVotesByRoomAndVoter(db, room.id, voterId);
    const myVotes: Record<string, string> = {};
    for (const vote of votes) {
      myVotes[vote.item_id] = vote.vote;
    }
    response.myVotes = myVotes;
  }

  return Response.json(response);
});

// POST /api/rooms/:code/join — Register as a participant
rooms.post("/:code/join", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { voterId, voterName } = body;

  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  // Upsert: ignore if already joined
  const existing = await db
    .prepare("SELECT id FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first();

  if (!existing) {
    await db
      .prepare("INSERT INTO participants (id, room_id, voter_id, voter_name) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), room.id, voterId, voterName.trim())
      .run();
  }

  return Response.json({ success: true });
});

// GET /api/rooms/:code/participants — List who has joined
rooms.get("/:code/participants", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const { results: rows } = await db
    .prepare("SELECT voter_id, voter_name, joined_at FROM participants WHERE room_id = ? ORDER BY joined_at ASC")
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string; joined_at: string }>();

  return Response.json({
    participants: rows.map((r) => ({
      voterId: r.voter_id,
      name: r.voter_name,
      isCreator: r.voter_id === room.creator_voter_id,
    })),
  });
});
