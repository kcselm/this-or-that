import { MODE_RULES, canStartWithItems, isMode, startItemsMessage } from "@tot/shared";
import { createRouter } from "../types";
import { generateCode } from "../lib/codes";
import {
  getRoomByCode,
  getItemsByRoomId,
  getItemCount,
  getSeriesHostVoterIds,
} from "../db/queries";
import {
  notFound,
  notCreator,
  invalidStatus,
  validationError,
  errorResponse,
} from "../lib/validation";
import { countParticipants, isParticipant, isValidName } from "../lib/participants";
import { nextRoomCodeFor } from "../lib/series";
import { modeHandler } from "../modes";

export const rooms = createRouter();

// POST /api/rooms — Create a new room
rooms.post("/", async (c) => {
  const body = await c.req.json();
  const { topic, creatorVoterId, creatorName } = body;

  if (typeof topic !== "string" || topic.trim().length < 1 || topic.trim().length > 100) {
    return validationError("Topic is required and must be 1-100 characters");
  }
  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }
  if (!isValidName(creatorName)) {
    return validationError("Creator name is required and must be 1-30 characters");
  }
  const mode = body.mode ?? "vote";
  if (!isMode(mode)) {
    return validationError("mode must be 'vote', 'rank', 'bracket', 'mlt', or 'tier'");
  }

  const db = c.env.DB;
  const id = crypto.randomUUID();

  // Successor-room creation: only the designated next host of a revealed
  // rank room may chain a new round onto it.
  let prevRoom: Awaited<ReturnType<typeof getRoomByCode>> = null;
  if (body.previousRoomCode !== undefined) {
    if (typeof body.previousRoomCode !== "string") {
      return validationError("previousRoomCode must be a string");
    }
    if (mode !== "rank") {
      return validationError("Only blind rank rooms can continue a series");
    }
    prevRoom = await getRoomByCode(db, body.previousRoomCode.toUpperCase());
    if (!prevRoom) return notFound();
    if (prevRoom.mode !== "rank") {
      return invalidStatus("Only blind rank rooms can continue a series");
    }
    if (prevRoom.status !== "revealed") {
      return invalidStatus("The previous round hasn't been revealed yet");
    }
    if (prevRoom.next_room_id) {
      return errorResponse("SERIES_CONTINUED", "The next round has already been created", 409);
    }
    if (prevRoom.next_host_voter_id !== creatorVoterId) {
      return errorResponse(
        "NOT_NEXT_HOST",
        "The host picked someone else to create the next round",
        403
      );
    }
  }

  // Generate a unique code
  let code: string;
  for (let attempts = 0; ; attempts++) {
    if (attempts >= 10) {
      return Response.json(
        { error: { code: "INTERNAL_ERROR", message: "Failed to generate unique code" } },
        { status: 500 }
      );
    }
    code = generateCode();
    // Check expired rooms too: rooms.code is UNIQUE, and an expired room keeps
    // its code until the cleanup cron deletes it.
    const existing = await db.prepare("SELECT id FROM rooms WHERE code = ?").bind(code).first();
    if (!existing) break;
  }

  const allowSuggestions = MODE_RULES[mode].suggestions && body.allowSuggestions ? 1 : 0;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const seriesId = prevRoom ? (prevRoom.series_id ?? prevRoom.id) : null;
  const roundNumber = prevRoom ? prevRoom.round_number + 1 : 1;

  await db
    .prepare(
      "INSERT INTO rooms (id, code, topic, creator_voter_id, status, allow_suggestions, mode, created_at, expires_at, series_id, round_number) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      code!,
      topic.trim(),
      creatorVoterId,
      allowSuggestions,
      mode,
      now,
      expiresAt,
      seriesId,
      roundNumber
    )
    .run();

  // Auto-join the creator as a participant
  await db
    .prepare("INSERT INTO participants (id, room_id, voter_id, voter_name) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), id, creatorVoterId, creatorName.trim())
    .run();

  if (prevRoom) {
    const link = await db
      .prepare(
        "UPDATE rooms SET next_room_id = ?, series_id = COALESCE(series_id, id) WHERE id = ? AND next_room_id IS NULL AND next_host_voter_id = ?"
      )
      .bind(id, prevRoom.id, creatorVoterId)
      .run();
    if ((link.meta.changes ?? 0) === 0) {
      // A concurrent create already linked a successor — remove our orphan.
      await db.batch([
        db.prepare("DELETE FROM participants WHERE room_id = ?").bind(id),
        db.prepare("DELETE FROM rooms WHERE id = ?").bind(id),
      ]);
      return errorResponse("SERIES_CONTINUED", "The next round has already been created", 409);
    }
  }

  return Response.json(
    { id, code: code!, topic: topic.trim(), mode, createdAt: now, expiresAt, roundNumber },
    { status: 201 }
  );
});

// POST /api/rooms/:code/items — Add items to a room
// Supports creator batch add (items[]) and single-item add (item) for both creator and participants
rooms.post("/:code/items", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { creatorVoterId, voterId, voterName } = body;

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.status !== "open")
    return invalidStatus("Items can only be added while the room is open");

  const isCreator = creatorVoterId && creatorVoterId === room.creator_voter_id;
  const rules = MODE_RULES[room.mode];

  if (!isCreator && !rules.suggestions) {
    return invalidStatus(`Participants cannot add items in a ${rules.label} room`);
  }

  const { maxItems, maxItemLength } = rules;

  // Determine item list from either `items` (batch) or `item` (single)
  let itemTitles: string[];
  if (body.item && typeof body.item === "string") {
    itemTitles = [body.item];
  } else if (Array.isArray(body.items)) {
    itemTitles = body.items;
  } else {
    return validationError("Either 'item' (string) or 'items' (array) is required");
  }

  if (itemTitles.length < 1 || itemTitles.length > maxItems) {
    return validationError(`Must provide 1-${maxItems} items`);
  }
  for (const item of itemTitles) {
    if (typeof item !== "string" || item.trim().length < 1 || item.trim().length > maxItemLength) {
      return validationError(`Each item must be a string of 1-${maxItemLength} characters`);
    }
  }

  if (!isCreator) {
    // Participant adding — check suggestions are enabled and user is a participant
    if (!voterId || typeof voterId !== "string") {
      return validationError("voterId is required for participant item adds");
    }
    if (!isValidName(voterName)) {
      return validationError("voterName is required for participant item adds");
    }
    if (!room.allow_suggestions) {
      return invalidStatus("The host has not enabled item suggestions for this room");
    }
    if (!(await isParticipant(db, room.id, voterId))) {
      return validationError("You must join the room before adding items");
    }
  }

  const currentCount = await getItemCount(db, room.id);
  if (currentCount + itemTitles.length > maxItems) {
    return validationError(
      `Adding ${itemTitles.length} item(s) would exceed the limit of ${maxItems} (currently ${currentCount})`
    );
  }

  const newItems = [];
  for (let i = 0; i < itemTitles.length; i++) {
    const itemId = crypto.randomUUID();
    const sortOrder = currentCount + i;
    const addedByVoterId = isCreator ? null : voterId;
    const addedByName = isCreator ? null : voterName.trim();
    await db
      .prepare(
        "INSERT INTO items (id, room_id, title, sort_order, added_by_voter_id, added_by_name) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(itemId, room.id, itemTitles[i].trim(), sortOrder, addedByVoterId, addedByName)
      .run();
    newItems.push({ id: itemId, title: itemTitles[i].trim(), sortOrder });
  }

  return Response.json(
    { items: newItems, totalItems: currentCount + itemTitles.length },
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
  if (room.status !== "open")
    return invalidStatus("Items can only be deleted while the room is open");

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
  if (!canStartWithItems(room.mode, itemCount)) {
    return validationError(startItemsMessage(room.mode));
  }
  const { label, minPlayersToStart } = MODE_RULES[room.mode];
  if (minPlayersToStart > 1 && (await countParticipants(db, room.id)) < minPlayersToStart) {
    return validationError(
      `${label[0].toUpperCase()}${label.slice(1)} rooms need at least ${minPlayersToStart} players to start`
    );
  }

  // Atomically claim the open→voting transition. A concurrent second start
  // loses here with a clean 400 instead of double-shuffling a rank room or
  // 500ing on the bracket's UNIQUE(room_id, round, slot).
  const claim = await db
    .prepare("UPDATE rooms SET status = 'voting' WHERE id = ? AND status = 'open'")
    .bind(room.id)
    .run();
  if ((claim.meta.changes ?? 0) === 0) {
    return invalidStatus("Room has already started voting");
  }

  await modeHandler(room.mode).onStart?.(db, room);

  return Response.json({ success: true, status: "voting", itemCount, mode: room.mode });
});

// GET /api/rooms/:code — Get room details
rooms.get("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const isCreator = voterId && voterId === room.creator_voter_id;

  const handler = modeHandler(room.mode);
  let items: { id: string; title: string; addedBy: { name: string } | null }[] = [];
  if (handler.showItems(room, !!isCreator)) {
    const allItems = await getItemsByRoomId(db, room.id);
    items = allItems.map((item) => ({
      id: item.id,
      title: item.title,
      addedBy: item.added_by_voter_id ? { name: item.added_by_name! } : null,
    }));
  }

  const response: Record<string, unknown> = {
    id: room.id,
    code: room.code,
    topic: room.topic,
    status: room.status,
    allowSuggestions: !!room.allow_suggestions,
    mode: room.mode,
    items,
  };

  // The viewer's own submissions so far, so a reopened app can resume.
  if (voterId) {
    Object.assign(response, await handler.myState?.(db, room, voterId));
  }

  response.roundNumber = room.round_number;
  const nextRoomCode = await nextRoomCodeFor(db, room);
  if (nextRoomCode) response.nextRoomCode = nextRoomCode;

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
  if (!isValidName(voterName)) {
    return validationError("voterName is required and must be 1-30 characters");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.status === "closed") {
    return invalidStatus("This room has been closed by the host");
  }
  if (room.status === "revealed") {
    return invalidStatus("Voting has already ended for this room");
  }

  // Upsert: insert or update name if already joined
  const existing = await db
    .prepare("SELECT id FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first();

  if (existing) {
    await db
      .prepare("UPDATE participants SET voter_name = ? WHERE room_id = ? AND voter_id = ?")
      .bind(voterName.trim(), room.id, voterId)
      .run();
  } else {
    await db
      .prepare("INSERT INTO participants (id, room_id, voter_id, voter_name) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), room.id, voterId, voterName.trim())
      .run();
  }

  return Response.json({ success: true });
});

// GET /api/rooms/:code/participants — List who has joined
// voter_id is the only credential in the system, so it must never appear in
// a response. Participants are identified by their public participant id;
// pass ?voterId= to have your own row flagged with isYou.
rooms.get("/:code/participants", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const { results: rows } = await db
    .prepare(
      "SELECT id, voter_id, voter_name, joined_at FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ id: string; voter_id: string; voter_name: string; joined_at: string }>();

  return Response.json({
    participants: rows.map((r) => ({
      participantId: r.id,
      name: r.voter_name,
      isCreator: r.voter_id === room.creator_voter_id,
      isYou: !!voterId && r.voter_id === voterId,
    })),
  });
});

// PATCH /api/rooms/:code/settings — Update room settings (creator only)
rooms.patch("/:code/settings", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { creatorVoterId, allowSuggestions } = body;

  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }
  if (typeof allowSuggestions !== "boolean") {
    return validationError("allowSuggestions must be a boolean");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.status !== "open")
    return invalidStatus("Settings can only be changed while the room is open");
  if (allowSuggestions && !MODE_RULES[room.mode].suggestions) {
    return invalidStatus(
      `Item suggestions are not available in ${MODE_RULES[room.mode].label} rooms`
    );
  }

  await db
    .prepare("UPDATE rooms SET allow_suggestions = ? WHERE id = ?")
    .bind(allowSuggestions ? 1 : 0, room.id)
    .run();

  return Response.json({ success: true, allowSuggestions });
});

// POST /api/rooms/:code/close — Close a room (creator only)
rooms.post("/:code/close", async (c) => {
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
  if (room.status === "closed") return invalidStatus("Room is already closed");
  if (room.status === "revealed") {
    return invalidStatus("Results are already revealed — closing would hide them");
  }

  await db.prepare("UPDATE rooms SET status = 'closed' WHERE id = ?").bind(room.id).run();

  return Response.json({ success: true, status: "closed" });
});

// POST /api/rooms/:code/next-host — Pick who hosts the next round (creator only)
// Omit nextParticipantId for a random draw that skips anyone who has already
// hosted a round in this series; once everyone has hosted, the pool resets
// (minus the current host, so random never repeats back-to-back).
rooms.post("/:code/next-host", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { creatorVoterId, nextParticipantId } = body;

  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.mode !== "rank") {
    return invalidStatus("Keep playing is only available in blind rank rooms");
  }
  if (room.status !== "revealed") {
    return invalidStatus("The next host can only be picked after results are revealed");
  }
  if (room.next_room_id) {
    return errorResponse("SERIES_CONTINUED", "The next round has already been created", 409);
  }

  const { results: parts } = await db
    .prepare(
      "SELECT id, voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ id: string; voter_id: string; voter_name: string }>();

  let chosen: { id: string; voter_id: string; voter_name: string } | undefined;
  if (nextParticipantId !== undefined) {
    if (typeof nextParticipantId !== "string") {
      return validationError("nextParticipantId must be a string");
    }
    chosen = parts.find((p) => p.id === nextParticipantId);
    if (!chosen) {
      return validationError("nextParticipantId is not a participant of this room");
    }
  } else {
    const seriesId = room.series_id ?? room.id;
    const hosted = new Set(await getSeriesHostVoterIds(db, seriesId));
    let pool = parts.filter((p) => !hosted.has(p.voter_id));
    if (pool.length === 0) {
      // Everyone has hosted — reset, but never repeat the current host
      // back-to-back unless they are the only participant.
      pool = parts.filter((p) => p.voter_id !== room.creator_voter_id);
      if (pool.length === 0) pool = parts;
    }
    chosen = pool[Math.floor(Math.random() * pool.length)];
  }

  const pick = await db
    .prepare("UPDATE rooms SET next_host_voter_id = ? WHERE id = ? AND next_room_id IS NULL")
    .bind(chosen.voter_id, room.id)
    .run();
  if ((pick.meta.changes ?? 0) === 0) {
    return errorResponse("SERIES_CONTINUED", "The next round has already been created", 409);
  }

  return Response.json({
    nextHost: { participantId: chosen.id, name: chosen.voter_name },
  });
});
