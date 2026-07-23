import { createRouter } from "../types";
import { generateCode } from "../lib/codes";
import { getRoomByCode, getItemsByRoomId, getItemCount, getVotesByRoomAndVoter, getRankingsByRoomAndVoter, getMltVotesByVoter, getTierPlacementsByVoter } from "../db/queries";
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
  const mode = body.mode ?? "vote";
  if (
    mode !== "vote" &&
    mode !== "rank" &&
    mode !== "bracket" &&
    mode !== "mlt" &&
    mode !== "tier"
  ) {
    return validationError("mode must be 'vote', 'rank', 'bracket', 'mlt', or 'tier'");
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

  const allowSuggestions = (mode === "rank" || mode === "bracket" || mode === "tier") ? 0 : (body.allowSuggestions ? 1 : 0);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      "INSERT INTO rooms (id, code, topic, creator_voter_id, status, allow_suggestions, mode, created_at, expires_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)"
    )
    .bind(id, code!, topic.trim(), creatorVoterId, allowSuggestions, mode, now, expiresAt)
    .run();

  // Auto-join the creator as a participant
  await db
    .prepare("INSERT INTO participants (id, room_id, voter_id, voter_name) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), id, creatorVoterId, creatorName.trim())
    .run();

  return Response.json(
    { id, code: code!, topic: topic.trim(), mode, createdAt: now, expiresAt },
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
  if (room.status !== "open") return invalidStatus("Items can only be added while the room is open");

  const isCreator = creatorVoterId && creatorVoterId === room.creator_voter_id;

  if (!isCreator && (room.mode === "rank" || room.mode === "bracket" || room.mode === "tier")) {
    return invalidStatus(
      room.mode === "rank"
        ? "Participants cannot add items in a blind rank room"
        : room.mode === "bracket"
        ? "Participants cannot add items in a bracket room"
        : "Participants cannot add items in a tier list room"
    );
  }

  const maxItems =
    room.mode === "rank" ? 5 :
    room.mode === "bracket" ? 16 :
    room.mode === "tier" ? 12 : 15;

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
    if (typeof item !== "string" || item.trim().length < 1 || item.trim().length > 100) {
      return validationError("Each item must be a string of 1-100 characters");
    }
    if (room.mode === "mlt" && item.trim().length > 80) {
      return validationError("Most Likely To prompts must be 80 characters or fewer");
    }
  }

  if (!isCreator) {
    // Participant adding — check suggestions are enabled and user is a participant
    if (!voterId || typeof voterId !== "string") {
      return validationError("voterId is required for participant item adds");
    }
    if (!voterName || typeof voterName !== "string") {
      return validationError("voterName is required for participant item adds");
    }
    if (!room.allow_suggestions) {
      return invalidStatus("The host has not enabled item suggestions for this room");
    }
    const participant = await db
      .prepare("SELECT id FROM participants WHERE room_id = ? AND voter_id = ?")
      .bind(room.id, voterId)
      .first();
    if (!participant) {
      return validationError("You must join the room before adding items");
    }
  }

  const currentCount = await getItemCount(db, room.id);
  if (currentCount + itemTitles.length > maxItems) {
    return validationError(`Adding ${itemTitles.length} item(s) would exceed the limit of ${maxItems} (currently ${currentCount})`);
  }

  const newItems = [];
  for (let i = 0; i < itemTitles.length; i++) {
    const itemId = crypto.randomUUID();
    const sortOrder = currentCount + i;
    const addedByVoterId = isCreator ? null : voterId;
    const addedByName = isCreator ? null : voterName;
    await db
      .prepare("INSERT INTO items (id, room_id, title, sort_order, added_by_voter_id, added_by_name) VALUES (?, ?, ?, ?, ?, ?)")
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
  if (room.mode === "rank") {
    if (itemCount !== 5) {
      return validationError("Blind rank rooms must have exactly 5 items to start");
    }
  } else if (room.mode === "bracket") {
    if (itemCount < 4 || itemCount > 16) {
      return validationError("Bracket rooms need between 4 and 16 items to start");
    }
  } else if (room.mode === "mlt") {
    if (itemCount < 3 || itemCount > 15) {
      return validationError("Most Likely To rooms need between 3 and 15 prompts to start");
    }
    const participantsRow = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();
    if ((participantsRow?.count ?? 0) < 3) {
      return validationError("Most Likely To rooms need at least 3 participants to start");
    }
  } else if (room.mode === "tier") {
    if (itemCount < 3 || itemCount > 12) {
      return validationError("Tier list rooms need between 3 and 12 items to start");
    }
  } else {
    if (itemCount < 2) {
      return validationError("Room must have at least 2 items to start voting");
    }
  }

  if (room.mode === "rank") {
    const items = await db
      .prepare("SELECT id FROM items WHERE room_id = ? ORDER BY sort_order ASC")
      .bind(room.id)
      .all<{ id: string }>();
    const ids = items.results.map((r) => r.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    const statements = ids.map((id, order) =>
      db
        .prepare("UPDATE items SET presentation_order = ? WHERE id = ?")
        .bind(order, id)
    );
    statements.push(
      db
        .prepare("UPDATE rooms SET status = 'voting' WHERE id = ?")
        .bind(room.id)
    );
    await db.batch(statements);
  } else if (room.mode === "bracket") {
    // Shuffle items
    const items = await db
      .prepare("SELECT id FROM items WHERE room_id = ? ORDER BY sort_order ASC")
      .bind(room.id)
      .all<{ id: string }>();
    const ids = items.results.map((r) => r.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    const N = ids.length;
    let P = 1;
    while (P < N) P *= 2;            // next power of 2 ≥ N
    const realMatchups = N - P / 2;  // number of round-1 matchups with both items
    const byes = P - N;               // number of round-1 bye matchups

    const nowIso = new Date().toISOString();
    const statements: any[] = [];

    // Real Round 1 matchups: items 0..(realMatchups*2 - 1) paired adjacently.
    for (let slot = 0; slot < realMatchups; slot++) {
      const itemA = ids[slot * 2];
      const itemB = ids[slot * 2 + 1];
      statements.push(
        db
          .prepare(
            "INSERT INTO matchups (id, room_id, round, slot, item_a_id, item_b_id, is_bye) VALUES (?, ?, 1, ?, ?, ?, 0)"
          )
          .bind(crypto.randomUUID(), room.id, slot, itemA, itemB)
      );
    }

    // Bye matchups: remaining items each get their own slot, already decided.
    for (let i = 0; i < byes; i++) {
      const slot = realMatchups + i;
      const itemA = ids[realMatchups * 2 + i];
      statements.push(
        db
          .prepare(
            "INSERT INTO matchups (id, room_id, round, slot, item_a_id, is_bye, winner_item_id, decided_at) VALUES (?, ?, 1, ?, ?, 1, ?, ?)"
          )
          .bind(crypto.randomUUID(), room.id, slot, itemA, itemA, nowIso)
      );
    }

    statements.push(
      db.prepare("UPDATE rooms SET status = 'voting' WHERE id = ?").bind(room.id)
    );

    await db.batch(statements);
  } else {
    // vote mode: just flip status
    await db
      .prepare("UPDATE rooms SET status = 'voting' WHERE id = ?")
      .bind(room.id)
      .run();
  }

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

  // In open status: creator always sees items; participants see items only if suggestions enabled
  let items: { id: string; title: string; addedBy: { voterId: string; name: string } | null }[] = [];
  const showItemsForVoteMode =
    room.mode === "vote" &&
    (room.status !== "open" || isCreator || room.allow_suggestions);
  const showItemsForRankMode = room.mode === "rank" && room.status === "open" && isCreator;
  const showItemsForBracketMode = room.mode === "bracket" && room.status === "open" && isCreator;
  const showItemsForMltMode =
    room.mode === "mlt" && (room.status !== "open" || isCreator);
  const showItemsForTierMode =
    room.mode === "tier" && (room.status !== "open" || isCreator);
  if (
    showItemsForVoteMode ||
    showItemsForRankMode ||
    showItemsForBracketMode ||
    showItemsForMltMode ||
    showItemsForTierMode
  ) {
    const allItems = await getItemsByRoomId(db, room.id);
    items = allItems.map((item) => ({
      id: item.id,
      title: item.title,
      addedBy: item.added_by_voter_id
        ? { voterId: item.added_by_voter_id, name: item.added_by_name! }
        : null,
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

  if (voterId) {
    const votes = await getVotesByRoomAndVoter(db, room.id, voterId);
    const myVotes: Record<string, string> = {};
    for (const vote of votes) {
      myVotes[vote.item_id] = vote.vote;
    }
    response.myVotes = myVotes;

    if (room.mode === "rank") {
      const rankings = await getRankingsByRoomAndVoter(db, room.id, voterId);
      const myRankings: Record<string, number> = {};
      for (const r of rankings) {
        myRankings[r.item_id] = r.rank;
      }
      response.myRankings = myRankings;
    }

    if (room.mode === "mlt") {
      const mltVotes = await getMltVotesByVoter(db, room.id, voterId);
      const myMltVotes: Record<string, string> = {};
      for (const v of mltVotes) {
        myMltVotes[v.item_id] = v.target_voter_id;
      }
      response.myMltVotes = myMltVotes;
    }

    if (room.mode === "tier") {
      const placements = await getTierPlacementsByVoter(db, room.id, voterId);
      const myTiers: Record<string, string> = {};
      for (const p of placements) {
        myTiers[p.item_id] = p.tier;
      }
      response.myTiers = myTiers;
    }
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
  if (room.status !== "open") return invalidStatus("Settings can only be changed while the room is open");
  if (room.mode === "rank" && allowSuggestions === true) {
    return invalidStatus("Item suggestions are not available in blind rank rooms");
  }
  if (room.mode === "bracket" && allowSuggestions === true) {
    return invalidStatus("Item suggestions are not available in bracket rooms");
  }
  if (room.mode === "tier" && allowSuggestions === true) {
    return invalidStatus("Item suggestions are not available in tier list rooms");
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

  await db
    .prepare("UPDATE rooms SET status = 'closed' WHERE id = ?")
    .bind(room.id)
    .run();

  return Response.json({ success: true, status: "closed" });
});
