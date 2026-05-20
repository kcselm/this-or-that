# Blind Rank Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second game mode (Blind Rank) alongside the existing Swipe Vote mode. Host picks 5 items; players (host included) rank them one at a time via drag-and-drop without seeing what's coming next. No scoring — reveal compares everyone's rankings.

**Architecture:** Add `mode` column on rooms (default `'vote'`), add `rankings` table, add `presentation_order` column on items. Mode-specific behavior lives in mode-specific routes (`routes/rankings.ts`) and screens (`app/room/[code]/rank.tsx`); existing swipe-mode code is untouched. Dispatch on `mode` happens at navigation boundaries (lobby, share, results screens).

**Tech Stack:** Hono on Cloudflare Workers + D1 SQLite (API). Expo Router + React Native + react-native-gesture-handler + react-native-reanimated (mobile, cross-platform iOS/Android/web).

**Reference spec:** `docs/superpowers/specs/2026-05-20-blind-rank-game-mode-design.md`

**Testing note:** Project has no automated test infrastructure yet (per CLAUDE.md: "add after MVP"). Each task uses manual verification (curl + `wrangler dev` for API, `npx expo start` + on-device checks for mobile). Don't introduce a test framework unless the user asks.

---

## File map

**API — modify:**
- `apps/api/src/types.ts` — add `Ranking` type, extend `Room`/`Item`
- `apps/api/src/db/queries.ts` — add rankings helpers
- `apps/api/src/routes/rooms.ts` — accept `mode` on create, mode-aware item cap, mode-aware start validation, include `mode` in GET, omit items for rank rooms post-start
- `apps/api/src/routes/votes.ts` — reject if room is rank mode
- `apps/api/src/routes/results.ts` — dispatch `/status` completion check and `/results` shape on mode
- `apps/api/src/index.ts` — mount rankings router

**API — create:**
- `apps/api/migrations/0005_blind_rank_mode.sql`
- `apps/api/src/routes/rankings.ts` — `/next-item`, `POST /rankings`

**Mobile — modify:**
- `apps/mobile/lib/api.ts` — add rank client functions, type updates
- `apps/mobile/app/_layout.tsx` — register new screens
- `apps/mobile/app/index.tsx` — rejoin honors mode
- `apps/mobile/app/create/index.tsx` — accept mode param, hide suggestions toggle for rank
- `apps/mobile/app/create/share.tsx` — mode-aware item cap (5 in rank), mode-aware start navigation
- `apps/mobile/app/room/[code]/lobby.tsx` — dispatch on mode when status becomes 'voting'
- `apps/mobile/app/room/[code]/waiting.tsx` — mode-aware "Swiping/Ranking" label
- `apps/mobile/app/room/[code]/results.tsx` — dispatch on mode

**Mobile — create:**
- `apps/mobile/app/create/mode.tsx` — mode picker screen
- `apps/mobile/app/room/[code]/rank.tsx` — drag-and-drop play screen
- `apps/mobile/components/RankCard.tsx` — draggable item card
- `apps/mobile/components/RankSlot.tsx` — drop-target slot
- `apps/mobile/components/RankPlayerCard.tsx` — reveal card per player

---

## Phase A — API

### Task 1: Database migration, types, query helpers

**Files:**
- Create: `apps/api/migrations/0005_blind_rank_mode.sql`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/db/queries.ts`

- [ ] **Step 1: Write the migration**

Create `apps/api/migrations/0005_blind_rank_mode.sql`:

```sql
ALTER TABLE rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'vote';
ALTER TABLE items ADD COLUMN presentation_order INTEGER;

CREATE TABLE rankings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id, item_id),
  UNIQUE(room_id, voter_id, rank)
);

CREATE INDEX idx_rankings_room ON rankings(room_id);
CREATE INDEX idx_rankings_room_voter ON rankings(room_id, voter_id);
```

- [ ] **Step 2: Update `apps/api/src/db/schema.sql` to mirror the same structure**

Add the new column, new table, and indexes so a fresh DB matches a migrated one. After the existing `items` table definition add `presentation_order INTEGER` to the column list. After the existing `votes` table add the `rankings` table. After the existing indexes add the two new ones. After the existing `rooms` columns add `mode TEXT NOT NULL DEFAULT 'vote'`.

The end-state of `apps/api/src/db/schema.sql`:

```sql
-- Rooms table
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  topic TEXT NOT NULL,
  creator_voter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  allow_suggestions INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'vote',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Items in a room
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  added_by_voter_id TEXT,
  added_by_name TEXT,
  presentation_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Votes (one per voter per item)
CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  vote TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);

-- Rankings (one per voter per item in rank mode; rank 1-5)
CREATE TABLE rankings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id, item_id),
  UNIQUE(room_id, voter_id, rank)
);

-- Participants (who has joined the room)
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id)
);

-- Indexes
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_items_room ON items(room_id);
CREATE INDEX idx_votes_room ON votes(room_id);
CREATE INDEX idx_votes_item ON votes(item_id);
CREATE INDEX idx_participants_room ON participants(room_id);
CREATE INDEX idx_rankings_room ON rankings(room_id);
CREATE INDEX idx_rankings_room_voter ON rankings(room_id, voter_id);
```

- [ ] **Step 3: Apply the migration locally**

Run from `apps/api/`:

```bash
cd apps/api
npx wrangler d1 migrations apply tot-db --local
```

Expected output: `Migrations to be applied: 0005_blind_rank_mode.sql` followed by success.

- [ ] **Step 4: Extend types in `apps/api/src/types.ts`**

Replace the whole file with:

```ts
export type Room = {
  id: string;
  code: string;
  topic: string;
  creator_voter_id: string;
  status: "open" | "voting" | "revealed" | "closed";
  allow_suggestions: number;
  mode: "vote" | "rank";
  created_at: string;
  expires_at: string;
};

export type Item = {
  id: string;
  room_id: string;
  title: string;
  sort_order: number;
  added_by_voter_id: string | null;
  added_by_name: string | null;
  presentation_order: number | null;
  created_at: string;
};

export type Vote = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  vote: "yes" | "no";
  created_at: string;
};

export type Ranking = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  rank: number;
  created_at: string;
};
```

Wait — note `apps/api/src/types.ts` (the Hono router types) is a different file from `apps/api/src/db/queries.ts` (the DB row types and helpers). Confirm by reading both before editing. In this codebase, `Room`/`Item`/`Vote` are exported from `db/queries.ts`. Apply the type changes there (this step) and DO NOT touch `src/types.ts` for the Hono types.

Concretely: open `apps/api/src/db/queries.ts` and update the top type definitions to match the block above (Room with `mode`, Item with `presentation_order`, and add the new `Ranking` type at the end).

- [ ] **Step 5: Add ranking query helpers to `apps/api/src/db/queries.ts`**

Append these helpers at the bottom of the file:

```ts
export async function getRankingsByRoomAndVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<Ranking[]> {
  const { results } = await db
    .prepare("SELECT * FROM rankings WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<Ranking>();
  return results;
}

export async function getRankingsByRoom(
  db: D1Database,
  roomId: string
): Promise<Ranking[]> {
  const { results } = await db
    .prepare("SELECT * FROM rankings WHERE room_id = ? ORDER BY voter_id, rank ASC")
    .bind(roomId)
    .all<Ranking>();
  return results;
}

export async function getNextRankItem(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<Item | null> {
  // Returns the item with the lowest presentation_order this voter has not yet ranked.
  const item = await db
    .prepare(
      `SELECT i.* FROM items i
       WHERE i.room_id = ?
         AND i.presentation_order IS NOT NULL
         AND i.id NOT IN (SELECT item_id FROM rankings WHERE room_id = ? AND voter_id = ?)
       ORDER BY i.presentation_order ASC
       LIMIT 1`
    )
    .bind(roomId, roomId, voterId)
    .first<Item>();
  return item;
}
```

- [ ] **Step 6: Compile-check**

Run from repo root:

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors. (If any callers reference `Room.mode` or `Item.presentation_order` and break, fix in the appropriate task below.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations/0005_blind_rank_mode.sql apps/api/src/db/schema.sql apps/api/src/db/queries.ts
git commit -m "$(cat <<'EOF'
feat(api): add migration, types, queries for blind rank mode

- 0005 migration: rooms.mode column, items.presentation_order column,
  new rankings table with UNIQUE(voter,item) and UNIQUE(voter,rank).
- Mirror in schema.sql so fresh DBs match migrated ones.
- Update Room/Item types and add Ranking type + helpers
  (getRankingsByRoomAndVoter, getRankingsByRoom, getNextRankItem).
EOF
)"
```

---

### Task 2: Update `routes/rooms.ts` — mode-aware create, items, start, GET

**Files:**
- Modify: `apps/api/src/routes/rooms.ts`

- [ ] **Step 1: Update `POST /api/rooms` to accept and persist `mode`**

In the handler for `rooms.post("/", ...)`:

After the existing validation block (after the `creatorName` length check), add mode validation:

```ts
const mode = body.mode ?? "vote";
if (mode !== "vote" && mode !== "rank") {
  return validationError("mode must be 'vote' or 'rank'");
}
```

Replace the `allowSuggestions` line — for rank rooms, suggestions must be off (they would spoil the blind aspect):

```ts
const allowSuggestions = mode === "rank" ? 0 : (body.allowSuggestions ? 1 : 0);
```

Update the INSERT to include `mode`. Replace the existing INSERT block with:

```ts
await db
  .prepare(
    "INSERT INTO rooms (id, code, topic, creator_voter_id, status, allow_suggestions, mode, created_at, expires_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)"
  )
  .bind(id, code!, topic.trim(), creatorVoterId, allowSuggestions, mode, now, expiresAt)
  .run();
```

Update the returned JSON to include `mode`:

```ts
return Response.json(
  { id, code: code!, topic: topic.trim(), mode, createdAt: now, expiresAt },
  { status: 201 }
);
```

- [ ] **Step 2: Update `POST /api/rooms/:code/items` to cap rank rooms at 5 items**

Currently the handler checks `if (currentCount + itemTitles.length > 15)`. Replace that block with mode-aware cap:

```ts
const maxItems = room.mode === "rank" ? 5 : 15;
if (itemTitles.length < 1 || itemTitles.length > maxItems) {
  return validationError(`Must provide 1-${maxItems} items`);
}
// ...keep the existing per-item length validation loop unchanged...
// then later:
const currentCount = await getItemCount(db, room.id);
if (currentCount + itemTitles.length > maxItems) {
  return validationError(`Adding ${itemTitles.length} item(s) would exceed the limit of ${maxItems} (currently ${currentCount})`);
}
```

(The "1-15 items" early check needs to come AFTER the `room` lookup so we know the mode. Restructure: move the `getRoomByCode` and `room` checks above the item-count validations. The status check `if (room.status !== "open")` and the participant-suggesting branch can stay where they are; just move them above the count caps if needed.)

Also: in rank mode, participant item suggestions are forbidden even if `allow_suggestions` were somehow true (defense in depth). Right after determining `isCreator`, add:

```ts
if (!isCreator && room.mode === "rank") {
  return invalidStatus("Participants cannot add items in a blind rank room");
}
```

- [ ] **Step 3: Update `POST /api/rooms/:code/start` — validate count + assign presentation_order for rank rooms**

Find the existing start handler. Replace the `if (itemCount < 2) ...` block and the UPDATE block with:

```ts
const itemCount = await getItemCount(db, room.id);
if (room.mode === "rank") {
  if (itemCount !== 5) {
    return validationError("Blind rank rooms must have exactly 5 items to start");
  }
} else {
  if (itemCount < 2) {
    return validationError("Room must have at least 2 items to start voting");
  }
}

// For rank rooms, assign a random presentation_order (0..4) to each item.
if (room.mode === "rank") {
  const items = await db
    .prepare("SELECT id FROM items WHERE room_id = ? ORDER BY sort_order ASC")
    .bind(room.id)
    .all<{ id: string }>();
  const ids = items.results.map((r) => r.id);
  // Fisher-Yates shuffle
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  for (let order = 0; order < ids.length; order++) {
    await db
      .prepare("UPDATE items SET presentation_order = ? WHERE id = ?")
      .bind(order, ids[order])
      .run();
  }
}

await db
  .prepare("UPDATE rooms SET status = 'voting' WHERE id = ?")
  .bind(room.id)
  .run();

return Response.json({ success: true, status: "voting", itemCount, mode: room.mode });
```

- [ ] **Step 4: Update `GET /api/rooms/:code` — include `mode`, hide items for rank rooms post-start, include `myRankings`**

Find the GET handler. Locate the block that builds the `items` array and the response. Replace the items-visibility branch with:

```ts
// Items visibility:
// - vote mode: creator always sees items; participants see only if suggestions enabled
//   OR room is past open status.
// - rank mode: creator sees items only during 'open' (for setup);
//   nobody sees items from this endpoint once voting starts (use /next-item instead).
let items: { id: string; title: string; addedBy: { voterId: string; name: string } | null }[] = [];
const showItemsForVoteMode =
  room.mode === "vote" &&
  (room.status !== "open" || isCreator || room.allow_suggestions);
const showItemsForRankMode = room.mode === "rank" && room.status === "open" && isCreator;
if (showItemsForVoteMode || showItemsForRankMode) {
  const allItems = await getItemsByRoomId(db, room.id);
  items = allItems.map((item) => ({
    id: item.id,
    title: item.title,
    addedBy: item.added_by_voter_id
      ? { voterId: item.added_by_voter_id, name: item.added_by_name! }
      : null,
  }));
}
```

Add `mode` to the response object. After `allowSuggestions: !!room.allow_suggestions,` add `mode: room.mode,`.

In the `if (voterId)` block, after building `myVotes`, also build `myRankings`:

```ts
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
}
```

Don't forget to add `getRankingsByRoomAndVoter` to the existing `import` line at the top of `rooms.ts`:

```ts
import { getRoomByCode, getItemsByRoomId, getItemCount, getVotesByRoomAndVoter, getRankingsByRoomAndVoter } from "../db/queries";
```

- [ ] **Step 5: Update `PATCH /api/rooms/:code/settings` — reject `allowSuggestions: true` on rank rooms**

In the settings handler, after the existing status check, add:

```ts
if (room.mode === "rank" && allowSuggestions === true) {
  return invalidStatus("Item suggestions are not available in blind rank rooms");
}
```

- [ ] **Step 6: Compile-check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/rooms.ts
git commit -m "$(cat <<'EOF'
feat(api): mode-aware rooms routes for blind rank

- POST /rooms accepts optional mode (default 'vote'); rank rooms force
  allow_suggestions off.
- POST /:code/items caps rank rooms at 5 items and rejects participant
  adds in rank mode (defense in depth).
- POST /:code/start requires exactly 5 items in rank mode and assigns
  a single random presentation_order to each item for all players.
- GET /:code returns mode, hides items for rank rooms after start
  (clients use /next-item), and returns myRankings alongside myVotes.
- PATCH /:code/settings rejects enabling suggestions on rank rooms.
EOF
)"
```

---

### Task 3: Reject vote submissions on rank rooms

**Files:**
- Modify: `apps/api/src/routes/votes.ts`

- [ ] **Step 1: Add mode check to `POST /api/rooms/:code/votes`**

In `votes.post("/:code/votes", ...)` immediately after the `if (room.status !== "voting") ...` line, add:

```ts
if (room.mode === "rank") {
  return validationError("This is a blind rank room — use /rankings instead of /votes");
}
```

- [ ] **Step 2: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/votes.ts
git commit -m "feat(api): reject vote submissions on rank-mode rooms"
```

---

### Task 4: Create `routes/rankings.ts` — next-item, submit, auto-reveal

**Files:**
- Create: `apps/api/src/routes/rankings.ts`

- [ ] **Step 1: Write the new router file**

Create `apps/api/src/routes/rankings.ts` with the full contents:

```ts
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
```

- [ ] **Step 2: Mount the new router in `apps/api/src/index.ts`**

Add the import and route registration. Replace the imports and route block:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "./types";
import { rooms } from "./routes/rooms";
import { votes } from "./routes/votes";
import { results } from "./routes/results";
import { rankings } from "./routes/rankings";

const app = new Hono<App>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON in request body" } },
      400
    );
  }
  console.error(err);
  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } },
    500
  );
});

app.route("/api/rooms", rooms);
app.route("/api/rooms", votes);
app.route("/api/rooms", results);
app.route("/api/rooms", rankings);

export default app;
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/rankings.ts apps/api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): add rankings router with next-item, submit, auto-reveal

- GET /:code/next-item returns the item with the lowest presentation_order
  the voter has not yet ranked (or null when done). Keeps the "blind"
  guarantee server-side.
- POST /:code/rankings inserts a placement; relies on UNIQUE
  (voter,item) and UNIQUE(voter,rank) constraints to enforce locking.
- Auto-reveal mirrors the votes-mode logic: when all participants
  have 5 rankings, transition status to 'revealed'.
EOF
)"
```

---

### Task 5: Update `routes/results.ts` — mode-aware `/status` and `/results`

**Files:**
- Modify: `apps/api/src/routes/results.ts`

- [ ] **Step 1: Make `/status` completion check mode-aware**

In the `/status` handler, the current query joins votes against participants. For rank mode the equivalent is rankings count ≥ 5. Replace the query block:

```ts
const totalItems = await getItemCount(db, room.id);

// Per-voter completed count.
// vote mode: voter is complete when vote_count >= totalItems.
// rank mode: voter is complete when ranking_count >= 5.
const submissionsTable = room.mode === "rank" ? "rankings" : "votes";
const requiredCount = room.mode === "rank" ? 5 : totalItems;

const { results: participantRows } = await db
  .prepare(
    `SELECT p.voter_id, p.voter_name, COALESCE(s.submission_count, 0) as submission_count
     FROM participants p
     LEFT JOIN (
       SELECT voter_id, COUNT(*) as submission_count
       FROM ${submissionsTable} WHERE room_id = ?
       GROUP BY voter_id
     ) s ON p.voter_id = s.voter_id
     WHERE p.room_id = ?`
  )
  .bind(room.id, room.id)
  .all<{ voter_id: string; voter_name: string; submission_count: number }>();

const voters = participantRows.map((row) => ({
  name: row.voter_name,
  completed: row.submission_count >= requiredCount,
}));
```

(Note: string interpolation of `submissionsTable` in SQL is safe here because the value is constrained to two literals derived from a server-side check, not from user input.)

The rest of the function (computing `completedCount`, `totalVoters`, the response shape) stays the same.

- [ ] **Step 2: Make `/results` mode-aware**

In the `/results` handler, after the `room` lookup, branch on mode. Replace the existing body with:

```ts
results.get("/:code/results", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  if (room.mode === "rank") {
    return getRankResults(c, db, room, voterId);
  }
  return getVoteResults(c, db, room);
});
```

Move the existing body into a helper `async function getVoteResults(c, db, room)`. Add a new helper:

```ts
async function getRankResults(
  c: any,
  db: D1Database,
  room: Room,
  voterId: string | undefined
) {
  if (room.status !== "revealed") {
    const totalParticipants = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();
    const completed = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT voter_id FROM rankings WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= 5
        )`
      )
      .bind(room.id)
      .first<{ completed: number }>();

    return Response.json({
      revealed: false,
      mode: "rank",
      completedCount: completed?.completed ?? 0,
      totalVoters: totalParticipants?.count ?? 0,
    });
  }

  // Fetch all rankings + items, group by voter.
  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const allRankings = await getRankingsByRoom(db, room.id);

  const participants = await db
    .prepare(
      "SELECT voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string }>();

  type PlayerRow = {
    voterId: string;
    name: string;
    isCreator: boolean;
    rankings: { rank: number; itemId: string; title: string }[];
  };

  const byVoter = new Map<string, PlayerRow>();
  for (const p of participants.results) {
    byVoter.set(p.voter_id, {
      voterId: p.voter_id,
      name: p.voter_name,
      isCreator: p.voter_id === room.creator_voter_id,
      rankings: [],
    });
  }
  for (const r of allRankings) {
    const row = byVoter.get(r.voter_id);
    if (!row) continue;
    row.rankings.push({
      rank: r.rank,
      itemId: r.item_id,
      title: titleById.get(r.item_id) ?? "",
    });
  }

  // Only include players who have all 5 rankings.
  const players: PlayerRow[] = [];
  for (const row of byVoter.values()) {
    if (row.rankings.length === 5) {
      row.rankings.sort((a, b) => a.rank - b.rank);
      players.push(row);
    }
  }

  // Sort: requesting voter first, then host, then by name.
  players.sort((a, b) => {
    if (voterId && a.voterId === voterId) return -1;
    if (voterId && b.voterId === voterId) return 1;
    if (a.isCreator && !b.isCreator) return -1;
    if (b.isCreator && !a.isCreator) return 1;
    return a.name.localeCompare(b.name);
  });

  return Response.json({
    revealed: true,
    mode: "rank",
    topic: room.topic,
    players,
  });
}
```

Update the imports at the top of `results.ts` to include the new helpers:

```ts
import { getRoomByCode, getItemsByRoomId, getItemCount, getRankingsByRoom, type Room } from "../db/queries";
```

(Note: `Room` was previously not imported here. The vote-side body already uses `room.status` etc. and works without the type, but the helper signature is typed.)

For the vote-mode helper, keep the existing behavior unchanged. Wrap it as:

```ts
async function getVoteResults(c: any, db: D1Database, room: Room) {
  // ...exactly the body that was previously in the handler, unchanged...
}
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/results.ts
git commit -m "$(cat <<'EOF'
feat(api): mode-aware /status completion and /results for rank rooms

- /status switches the per-voter completion query between votes and
  rankings tables based on room.mode (rank mode requires 5 placements).
- /results dispatches: rank mode returns players[] with each player's
  ranked top-5; sort puts the requesting voter first, then the host.
- Returns the not-revealed progress shape with `mode: 'rank'` so the
  client can render the right loading state.
EOF
)"
```

---

### Task 6: Manual API integration test

**Files:** none (verification only)

- [ ] **Step 1: Start the local API**

```bash
cd apps/api
npx wrangler dev
```

Wait for `Ready on http://localhost:8787`.

- [ ] **Step 2: Create a rank room (in a new terminal)**

```bash
curl -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"Best pizza topping","mode":"rank","creatorVoterId":"voter-host","creatorName":"Host"}'
```

Expected response: JSON with `"code": "XXXXXX"`, `"mode": "rank"`. Save the code into an env var for the next steps:

```bash
ROOM=<code-from-response>
```

- [ ] **Step 3: Add 5 items, verify 6th is rejected**

```bash
for t in Pepperoni Mushroom Sausage Pineapple Anchovy; do
  curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/items" \
    -H "Content-Type: application/json" \
    -d "{\"item\":\"$t\",\"creatorVoterId\":\"voter-host\"}"
  echo
done
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/items" \
  -H "Content-Type: application/json" \
  -d '{"item":"Olives","creatorVoterId":"voter-host"}'
echo
```

Expected: first 5 succeed; 6th returns `VALIDATION_ERROR` about exceeding the limit of 5.

- [ ] **Step 4: Try to start with <5 items in a new room — expect rejection**

(Optional — covers the inverse path. Create another rank room, add 3 items, try to start.) Skip if Step 3 satisfies you.

- [ ] **Step 5: Join a second participant**

```bash
curl -X POST "http://localhost:8787/api/rooms/$ROOM/join" \
  -H "Content-Type: application/json" \
  -d '{"voterId":"voter-bob","voterName":"Bob"}'
```

Expected: `{"success":true}`.

- [ ] **Step 6: Start the room**

```bash
curl -X POST "http://localhost:8787/api/rooms/$ROOM/start" \
  -H "Content-Type: application/json" \
  -d '{"creatorVoterId":"voter-host"}'
```

Expected: `{"success":true,"status":"voting","itemCount":5,"mode":"rank"}`.

- [ ] **Step 7: Both players walk through `/next-item` + submit rankings**

Function to play a full game for one voter (copy-paste in your shell):

```bash
play() {
  local voter=$1 name=$2
  for rank in 1 2 3 4 5; do
    local next=$(curl -s "http://localhost:8787/api/rooms/$ROOM/next-item?voterId=$voter")
    local item_id=$(echo "$next" | python -c "import json,sys; print(json.load(sys.stdin)['item']['id'])")
    curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/rankings" \
      -H "Content-Type: application/json" \
      -d "{\"itemId\":\"$item_id\",\"voterId\":\"$voter\",\"voterName\":\"$name\",\"rank\":$rank}" > /dev/null
  done
  echo "$name done"
}

play voter-host Host
play voter-bob Bob
```

Expected: both `done` lines print without error.

- [ ] **Step 8: Verify the room auto-revealed and results come back**

```bash
curl -s "http://localhost:8787/api/rooms/$ROOM/status"
curl -s "http://localhost:8787/api/rooms/$ROOM/results?voterId=voter-bob" | python -m json.tool
```

Expected: `/status` shows `"isRevealed": true`. `/results` shows `"revealed": true, "mode": "rank"` with 2 players, each with 5 rankings, and Bob first (requesting voter).

- [ ] **Step 9: Verify a double-placement is rejected**

```bash
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/rankings" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"any","voterId":"voter-bob","voterName":"Bob","rank":1}'
```

Expected: VALIDATION_ERROR (item not found OR locked). The room is already revealed so the status check also catches it. Either error is acceptable.

- [ ] **Step 10: Verify vote endpoint rejects on rank room**

```bash
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/votes" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"x","voterId":"voter-bob","voterName":"Bob","vote":"yes"}'
```

Expected: VALIDATION_ERROR mentioning rank/rankings.

- [ ] **Step 11: Sanity-check an existing vote-mode room still works**

Create a vote room, add 3 items, start it, submit a vote, fetch results. Expected: everything still functions identically to before.

```bash
VOTE=$(curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"test","creatorVoterId":"vh","creatorName":"VH"}' \
  | python -c "import json,sys; print(json.load(sys.stdin)['code'])")
echo "vote room: $VOTE"
for t in A B C; do
  curl -s -X POST "http://localhost:8787/api/rooms/$VOTE/items" \
    -H "Content-Type: application/json" \
    -d "{\"item\":\"$t\",\"creatorVoterId\":\"vh\"}" > /dev/null
done
curl -s -X POST "http://localhost:8787/api/rooms/$VOTE/start" \
  -H "Content-Type: application/json" \
  -d '{"creatorVoterId":"vh"}'
curl -s "http://localhost:8787/api/rooms/$VOTE" | python -m json.tool
```

Expected: returns `mode: "vote"`, items array populated.

- [ ] **Step 12: Commit (none — verification step)**

No code change. Leave the wrangler dev process running for the mobile phase, or stop it.

---

## Phase B — Mobile

### Task 7: Update `apps/mobile/lib/api.ts` — types and rank client functions

**Files:**
- Modify: `apps/mobile/lib/api.ts`

- [ ] **Step 1: Add `mode` to `RoomResponse` and `createRoom` body**

Find `export type RoomResponse` and add `mode` and `myRankings`:

```ts
export type RoomResponse = {
  id: string;
  code: string;
  topic: string;
  status: "open" | "voting" | "revealed" | "closed";
  allowSuggestions: boolean;
  mode: "vote" | "rank";
  items: RoomItem[];
  myVotes?: Record<string, string>;
  myRankings?: Record<string, number>;
};
```

Update `createRoom`:

```ts
export function createRoom(body: {
  topic: string;
  creatorVoterId: string;
  creatorName: string;
  allowSuggestions?: boolean;
  mode?: "vote" | "rank";
}) {
  return request<CreateRoomResponse & { mode: "vote" | "rank" }>("/rooms", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

Update `CreateRoomResponse` to include `mode`:

```ts
export type CreateRoomResponse = {
  id: string;
  code: string;
  topic: string;
  mode: "vote" | "rank";
  createdAt: string;
  expiresAt: string;
};
```

- [ ] **Step 2: Add rankings client functions at the bottom of the file**

```ts
// --- Rankings endpoints (blind rank mode) ---

export type NextItemResponse = {
  item: { id: string; title: string } | null;
  progress: { placed: number; total: number };
};

export function getNextRankItem(code: string, voterId: string) {
  return request<NextItemResponse>(
    `/rooms/${code}/next-item?voterId=${encodeURIComponent(voterId)}`
  );
}

export type RankingSubmitResponse = {
  success: boolean;
  progress: { placed: number; total: number };
};

export function submitRanking(
  code: string,
  body: { itemId: string; voterId: string; voterName: string; rank: number }
) {
  return request<RankingSubmitResponse>(`/rooms/${code}/rankings`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Rank results ---

export type RankResultsResponse =
  | {
      revealed: true;
      mode: "rank";
      topic: string;
      players: {
        voterId: string;
        name: string;
        isCreator: boolean;
        rankings: { rank: number; itemId: string; title: string }[];
      }[];
    }
  | {
      revealed: false;
      mode: "rank";
      completedCount: number;
      totalVoters: number;
    };
```

Update the existing `ResultsResponse` union to account for the rank shape:

```ts
export type ResultsResponse =
  | {
      revealed: true;
      topic: string;
      totalVoters: number;
      results: {
        itemId: string;
        title: string;
        yesCount: number;
        noCount: number;
        yesPercentage: number;
      }[];
    }
  | {
      revealed: false;
      completedCount: number;
      totalVoters: number;
    }
  | RankResultsResponse;
```

`getResults` already returns `ResultsResponse` — no signature change needed, but callers will need to discriminate by checking `'mode' in res && res.mode === 'rank'`.

- [ ] **Step 3: Add `add` helper for setting an item in rank-mode `addItems` (no batch change needed)**

The existing `addItem` (single) and `addItems` (batch) work for rank mode unchanged — the server enforces the 5-item cap. Skip this step; it's a no-op.

- [ ] **Step 4: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/lib/api.ts
git commit -m "feat(mobile-api): add mode field + rankings client functions"
```

---

### Task 8: New screen — mode picker (`app/create/mode.tsx`)

**Files:**
- Create: `apps/mobile/app/create/mode.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/index.tsx` (home: route "Create" to `/create/mode`)

- [ ] **Step 1: Create the mode picker screen**

`apps/mobile/app/create/mode.tsx`:

```tsx
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

export default function ModePickerScreen() {
  const router = useRouter();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.heading}>Pick a game mode</Text>

      <Animated.View entering={FadeInDown.duration(400).delay(100).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "vote" } })}
        >
          <Text style={styles.cardEmoji}>♥</Text>
          <Text style={styles.cardTitle}>Swipe Vote</Text>
          <Text style={styles.cardDescription}>
            Add a list of options. Everyone swipes yes or no. See what wins.
          </Text>
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(200).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardRank, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "rank" } })}
        >
          <Text style={styles.cardEmoji}>◎</Text>
          <Text style={styles.cardTitle}>Blind Rank</Text>
          <Text style={styles.cardDescription}>
            Pick 5 items. Players rank them one at a time without knowing what's coming next.
          </Text>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  heading: {
    ...typography.h1,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 2,
    borderColor: colors.sand,
    ...shadows.soft,
  },
  cardRank: {
    borderColor: colors.tealLight,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: colors.sandLight,
  },
  cardEmoji: {
    fontSize: 28,
    marginBottom: spacing.sm,
    color: colors.coral,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  cardDescription: {
    ...typography.body,
    color: colors.slate,
    lineHeight: 22,
  },
});
```

- [ ] **Step 2: Register the new screen in `apps/mobile/app/_layout.tsx`**

Add a `Stack.Screen` entry after the existing `create/index` line:

```tsx
<Stack.Screen name="create/mode" options={{ title: "New Room" }} />
```

Also add (will be used in later tasks; declare now to avoid forgetting):

```tsx
<Stack.Screen name="room/[code]/rank" options={{ headerShown: false }} />
```

- [ ] **Step 3: Update home to push `/create/mode` instead of `/create`**

In `apps/mobile/app/index.tsx`, find the Pressable with `onPress={() => router.push("/create")}` and change it to:

```tsx
onPress={() => router.push("/create/mode")}
```

- [ ] **Step 4: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/mode.tsx apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): add mode picker as first step of create flow"
```

---

### Task 9: Update `create/index.tsx` — accept mode, hide suggestions toggle for rank

**Files:**
- Modify: `apps/mobile/app/create/index.tsx`

- [ ] **Step 1: Read mode from route params; pass through to API**

Replace the top of the component (state and handler) with:

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
// ...other imports unchanged...

export default function CreateRoomScreen() {
  const router = useRouter();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: "vote" | "rank" = modeParam === "rank" ? "rank" : "vote";
  const [topic, setTopic] = useState("");
  const [name, setName] = useState("");
  const [allowSuggestions, setAllowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmedTopic = topic.trim();
    const trimmedName = name.trim();

    if (!trimmedTopic) return Alert.alert("Error", "Enter a topic");
    if (!trimmedName) return Alert.alert("Error", "Enter your name");

    setLoading(true);
    try {
      const voterId = await getVoterId();
      const room = await createRoom({
        topic: trimmedTopic,
        creatorVoterId: voterId,
        creatorName: trimmedName,
        allowSuggestions: mode === "vote" ? allowSuggestions : false,
        mode,
      });
      router.replace({
        pathname: "/create/share",
        params: { code: room.code, name: trimmedName, mode },
      });
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  };
  // ...
```

- [ ] **Step 2: Conditionally render the suggestions toggle**

Find the `<View style={styles.toggleRow}>` block (the suggestions Switch). Wrap it with `{mode === "vote" && (...)}`:

```tsx
{mode === "vote" && (
  <View style={styles.toggleRow}>
    {/* ...existing toggle markup unchanged... */}
  </View>
)}
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/index.tsx
git commit -m "feat(mobile): create screen accepts mode param, hides suggestions toggle in rank mode"
```

---

### Task 10: Update `create/share.tsx` — mode-aware item cap and start navigation

**Files:**
- Modify: `apps/mobile/app/create/share.tsx`

- [ ] **Step 1: Read mode from params and the room itself**

At the top of `ShareScreen()`, read `mode` from local search params (passed in from create/index) AND from the polled room data (in case of resume):

```tsx
const { code, name, mode: modeParam } = useLocalSearchParams<{ code: string; name: string; mode?: string }>();
const [mode, setMode] = useState<"vote" | "rank">(modeParam === "rank" ? "rank" : "vote");
```

Inside the existing `poll()` function, after `setItems(room.items)`, add:

```tsx
if (room.mode) setMode(room.mode);
```

- [ ] **Step 2: Compute the item cap based on mode**

Above the JSX return, add:

```tsx
const maxItems = mode === "rank" ? 5 : 15;
const canStart = mode === "rank" ? items.length === 5 : items.length >= 2;
```

In `handleAddItem`, replace the `if (items.length >= 15)` line:

```tsx
if (items.length >= maxItems) return Alert.alert("Limit", `Maximum ${maxItems} items`);
```

In `handleStart`, replace the `if (items.length < 2)` block:

```tsx
if (!canStart) {
  return Alert.alert(
    "Not ready",
    mode === "rank"
      ? "Blind rank rooms need exactly 5 items"
      : "Add at least 2 items to start voting"
  );
}
```

After `await startVoting(...)`, replace the navigation block:

```tsx
router.replace({
  pathname: mode === "rank" ? "/room/[code]/rank" : "/room/[code]/swipe",
  params: { code, name, isCreator: "true" },
});
```

- [ ] **Step 3: Hide the suggestions toggle in rank mode**

Find the `<Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.toggleRow}>` block (the Switch). Wrap it with `{mode === "vote" && (...)}`.

- [ ] **Step 4: Update the count badge text and Start button**

Find `<Text style={styles.countText}>{items.length}/15</Text>` and replace with `{items.length}/{maxItems}`.

Find `disabled={loading || items.length < 2}` and replace with `disabled={loading || !canStart}`.

Find `(loading || items.length < 2) && styles.buttonDisabled` and replace with `(loading || !canStart) && styles.buttonDisabled`.

Find `pressed && !loading && items.length >= 2 && styles.startButtonPressed` and replace with `pressed && !loading && canStart && styles.startButtonPressed`.

Find the Start button label `loading ? "Starting..." : "Start Voting"` and replace with:

```tsx
{loading ? "Starting..." : mode === "rank" ? "Start Ranking" : "Start Voting"}
```

- [ ] **Step 5: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/share.tsx
git commit -m "feat(mobile): share screen enforces 5-item cap and routes to rank screen on start in rank mode"
```

---

### Task 11: Build the drag-and-drop components — `RankSlot.tsx` and `RankCard.tsx`

**Files:**
- Create: `apps/mobile/components/RankSlot.tsx`
- Create: `apps/mobile/components/RankCard.tsx`

These are the two components that make the gameplay feel right. `RankSlot` is a layout target that reports its on-screen rect; `RankCard` is the draggable; the parent screen (Task 12) coordinates them.

- [ ] **Step 1: Create `RankSlot.tsx`**

```tsx
import { useRef } from "react";
import { View, Text, StyleSheet, type LayoutChangeEvent } from "react-native";
import { colors, spacing, radius, typography } from "../lib/theme";

export type SlotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  rank: number;
  filledTitle?: string | null;
  highlighted?: boolean;
  onMeasure?: (rank: number, rect: SlotRect) => void;
};

export default function RankSlot({ rank, filledTitle, highlighted, onMeasure }: Props) {
  const ref = useRef<View>(null);

  const handleLayout = (_: LayoutChangeEvent) => {
    // Use measureInWindow so absolute screen coordinates work for hit-testing
    // a gesture whose translation is in screen coordinates.
    ref.current?.measureInWindow((x, y, width, height) => {
      onMeasure?.(rank, { x, y, width, height });
    });
  };

  const filled = !!filledTitle;
  return (
    <View
      ref={ref}
      onLayout={handleLayout}
      style={[
        styles.slot,
        filled && styles.slotFilled,
        highlighted && styles.slotHighlighted,
      ]}
    >
      <View style={[styles.rankBadge, filled && styles.rankBadgeFilled]}>
        <Text style={[styles.rankNumber, filled && styles.rankNumberFilled]}>{rank}</Text>
      </View>
      <Text
        style={[styles.slotText, filled && styles.slotTextFilled]}
        numberOfLines={1}
      >
        {filledTitle ?? "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.sand,
    gap: spacing.md,
  },
  slotFilled: {
    backgroundColor: colors.sandLight,
    borderColor: colors.sand,
    opacity: 0.85,
  },
  slotHighlighted: {
    borderColor: colors.teal,
    backgroundColor: colors.tealLight,
    transform: [{ scale: 1.02 }],
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  rankBadgeFilled: {
    backgroundColor: colors.sand,
  },
  rankNumber: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  rankNumberFilled: {
    color: colors.slate,
  },
  slotText: {
    ...typography.bodyBold,
    color: colors.mist,
    flex: 1,
  },
  slotTextFilled: {
    color: colors.charcoal,
  },
});
```

- [ ] **Step 2: Create `RankCard.tsx`**

```tsx
import { useImperativeHandle, forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { colors, radius, shadows, typography, spacing } from "../lib/theme";

export type RankCardHandle = {
  /** Animate the card into the given absolute-screen point and notify when done. */
  flyTo: (point: { x: number; y: number }, onComplete: () => void) => void;
};

type Props = {
  title: string;
  onDragMove: (absX: number, absY: number) => void;
  onDragEnd: (absX: number, absY: number) => void;
};

const RankCard = forwardRef<RankCardHandle, Props>(function RankCard(
  { title, onDragMove, onDragEnd },
  ref
) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  useImperativeHandle(ref, () => ({
    flyTo: (_point, onComplete) => {
      // Caller is responsible for unmounting; we just shrink+fade locally.
      translateX.value = withTiming(translateX.value, { duration: 150 });
      translateY.value = withTiming(translateY.value, { duration: 150 }, () => {
        runOnJS(onComplete)();
      });
    },
  }));

  const gesture = Gesture.Pan()
    .onStart((e) => {
      startX.value = e.absoluteX - e.x;
      startY.value = e.absoluteY - e.y;
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      runOnJS(onDragMove)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      runOnJS(onDragEnd)(e.absoluteX, e.absoluteY);
      // Spring back; the screen will replace the card if a drop succeeded.
      translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animatedStyle]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>drag to a slot</Text>
      </Animated.View>
    </GestureDetector>
  );
});

export default RankCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.coralLight,
    ...shadows.card,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.charcoal,
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.mist,
  },
});
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/components/RankSlot.tsx apps/mobile/components/RankCard.tsx
git commit -m "feat(mobile): add RankSlot and RankCard components for blind rank play screen"
```

---

### Task 12: Build the rank play screen (`app/room/[code]/rank.tsx`)

**Files:**
- Create: `apps/mobile/app/room/[code]/rank.tsx`

The screen owns: the current item card, the 5 slots, the drag-coordinate state, and the API calls. On drag-end, it computes which slot (if any) the drop point falls into using slot rects reported via `onMeasure`. If a valid empty slot, it locks that slot, submits the ranking, and asks for the next item.

- [ ] **Step 1: Write the screen file**

```tsx
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import RankCard from "../../../components/RankCard";
import RankSlot, { type SlotRect } from "../../../components/RankSlot";
import {
  getRoom,
  getNextRankItem,
  submitRanking,
  ApiError,
} from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { colors, spacing, typography } from "../../../lib/theme";

type CurrentItem = { id: string; title: string } | null;

export default function RankScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();

  const [topic, setTopic] = useState<string>("");
  const [current, setCurrent] = useState<CurrentItem>(null);
  const [placed, setPlaced] = useState<Record<number, string>>({}); // rank -> title
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [highlightRank, setHighlightRank] = useState<number | null>(null);

  const slotRects = useRef<Record<number, SlotRect>>({});

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      const room = await getRoom(code, voterId);
      if (room.mode !== "rank") {
        setError("This room isn't a blind rank room.");
        setLoading(false);
        return;
      }
      setTopic(room.topic);

      // Repaint locked slots from myRankings if resuming.
      // myRankings maps itemId -> rank; we need a rank -> title map. Server omits
      // items for rank rooms post-start, so we fetch /results in the not-revealed
      // branch only to get titles. Simpler: fetch from items endpoint won't work.
      // Instead: record placed slots as "•" placeholder when title is unknown.
      // (Server-enforced blind keeps title list private; resume after close
      // still works — slots show the rank locked, item title shows after reveal.)
      if (room.myRankings && Object.keys(room.myRankings).length > 0) {
        const placedMap: Record<number, string> = {};
        for (const rank of Object.values(room.myRankings)) {
          placedMap[rank] = "•"; // placeholder; titles aren't disclosed mid-game
        }
        setPlaced(placedMap);
      }

      const next = await getNextRankItem(code, voterId);
      if (next.item) {
        setCurrent(next.item);
      } else {
        navigateToWaiting();
      }
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the room.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const navigateToWaiting = () => {
    router.replace({
      pathname: "/room/[code]/waiting",
      params: { code, name, isCreator: isCreator ?? "false" },
    });
  };

  const handleSlotMeasure = (rank: number, rect: SlotRect) => {
    slotRects.current[rank] = rect;
  };

  const findSlotAt = (x: number, y: number): number | null => {
    for (let rank = 1; rank <= 5; rank++) {
      const r = slotRects.current[rank];
      if (!r) continue;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return rank;
      }
    }
    return null;
  };

  const handleDragMove = (absX: number, absY: number) => {
    const hit = findSlotAt(absX, absY);
    if (hit && !placed[hit]) {
      setHighlightRank(hit);
    } else {
      setHighlightRank(null);
    }
  };

  const handleDragEnd = async (absX: number, absY: number) => {
    setHighlightRank(null);
    const hit = findSlotAt(absX, absY);
    if (!hit || placed[hit] || !current || submitting) return;

    setSubmitting(true);
    const placingTitle = current.title;
    const placingRank = hit;

    // Optimistic UI: lock the slot immediately.
    setPlaced((prev) => ({ ...prev, [placingRank]: placingTitle }));

    try {
      const voterId = await getVoterId();
      await submitRanking(code, {
        itemId: current.id,
        voterId,
        voterName: name,
        rank: placingRank,
      });

      const next = await getNextRankItem(code, voterId);
      if (next.item) {
        setCurrent(next.item);
      } else {
        navigateToWaiting();
      }
    } catch (e: any) {
      // Roll back the optimistic placement.
      setPlaced((prev) => {
        const copy = { ...prev };
        delete copy[placingRank];
        return copy;
      });
      Alert.alert("Error", e instanceof ApiError ? e.message : "Couldn't submit your placement.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={loadInitial}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  const placedCount = Object.keys(placed).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={1}>{topic}</Text>
        <Text style={styles.progress}>{placedCount + (current ? 1 : 0)} of 5</Text>
      </View>

      <View style={styles.cardArea}>
        {current && (
          <Animated.View key={current.id} entering={FadeIn.duration(200)} style={styles.cardWrap}>
            <RankCard
              title={current.title}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
            />
          </Animated.View>
        )}
      </View>

      <View style={styles.slots}>
        {[1, 2, 3, 4, 5].map((rank) => (
          <RankSlot
            key={rank}
            rank={rank}
            filledTitle={placed[rank] ?? null}
            highlighted={highlightRank === rank}
            onMeasure={handleSlotMeasure}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.cream,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  topic: {
    ...typography.h2,
    color: colors.charcoal,
    flex: 1,
    marginRight: spacing.md,
  },
  progress: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  cardArea: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  cardWrap: {
    width: "85%",
  },
  slots: {
    gap: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.coral,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 16,
  },
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
});
```

Important behavior notes captured in this file:
- **Resume after close:** the screen reads `myRankings` from `getRoom` and locks the right slots with `"•"` as a placeholder (titles aren't disclosed mid-game, by design).
- **Drop hit-testing:** uses screen-absolute coordinates from gesture handler + slot rects from `measureInWindow`. Works on iOS, Android, and web (gesture-handler's web build emits absoluteX/Y from pointer events).
- **Optimistic UI:** the slot fills instantly and rolls back on error. Submit and the next-item fetch happen after.

- [ ] **Step 2: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/rank.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add blind rank play screen with drag-and-drop

Drag the current item card onto an empty slot to lock that rank.
Locked slots refuse drops; release outside any slot springs the card
back. Optimistic UI fills slots on drop and rolls back on submit
error. Uses absolute-screen coordinates so it works on iOS/Android/web
via react-native-gesture-handler.
EOF
)"
```

---

### Task 13: Dispatch on mode in `lobby.tsx` (participants) and the home rejoin

**Files:**
- Modify: `apps/mobile/app/room/[code]/lobby.tsx`
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Update lobby's mode-aware navigation when status becomes `voting`**

In `apps/mobile/app/room/[code]/lobby.tsx`, find the block:

```tsx
} else if (room.status === "voting") {
  clearInterval(intervalRef.current);
  router.replace({
    pathname: "/room/[code]/swipe",
    params: { code, name },
  });
  return;
```

Replace with:

```tsx
} else if (room.status === "voting") {
  clearInterval(intervalRef.current);
  router.replace({
    pathname: room.mode === "rank" ? "/room/[code]/rank" : "/room/[code]/swipe",
    params: { code, name },
  });
  return;
```

- [ ] **Step 2: Hide collaborative items section in rank mode (defensive — server already prevents)**

The lobby's items section is gated on `allowSuggestions`. Since the API forces `allow_suggestions=false` for rank rooms, this is already hidden. No client change needed. (Skip this step; it's a no-op note.)

- [ ] **Step 3: Update home rejoin to honor mode**

In `apps/mobile/app/index.tsx`, find the `handleRejoin` function. The `data.status === "voting"` branch routes to swipe. Update it:

```tsx
} else if (data.status === "voting") {
  router.push({
    pathname: data.mode === "rank" ? "/room/[code]/rank" : "/room/[code]/swipe",
    params: { code: activeRoom.code, name: activeRoom.name },
  });
}
```

- [ ] **Step 4: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/lobby.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): lobby and home-rejoin dispatch to rank screen for rank rooms"
```

---

### Task 14: Mode-aware label on waiting screen

**Files:**
- Modify: `apps/mobile/app/room/[code]/waiting.tsx`

- [ ] **Step 1: Fetch the room mode once on mount, switch the in-progress label**

At the top of `WaitingScreen()`, add a `mode` state and fetch it once:

```tsx
const [mode, setMode] = useState<"vote" | "rank">("vote");

useEffect(() => {
  (async () => {
    try {
      const room = await getRoom(code);
      setMode(room.mode);
    } catch {}
  })();
}, [code]);
```

You'll need to import `getRoom` from `../../../lib/api` if it's not already imported.

Find the voter chip block where the badge text reads `"Swiping..."`. Replace with:

```tsx
{voter.completed ? "Done" : mode === "rank" ? "Ranking..." : "Swiping..."}
```

- [ ] **Step 2: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/waiting.tsx
git commit -m "feat(mobile): waiting screen shows 'Ranking...' label for rank rooms"
```

---

### Task 15: Rank reveal — `RankPlayerCard` component + results dispatch

**Files:**
- Create: `apps/mobile/components/RankPlayerCard.tsx`
- Modify: `apps/mobile/app/room/[code]/results.tsx`

- [ ] **Step 1: Create `RankPlayerCard.tsx`**

```tsx
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Props = {
  name: string;
  isYou: boolean;
  isCreator: boolean;
  rankings: { rank: number; itemId: string; title: string }[];
};

export default function RankPlayerCard({ name, isYou, isCreator, rankings }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.name}>{isYou ? `${name} (You)` : name}</Text>
        {isCreator && (
          <View style={styles.hostBadge}>
            <Text style={styles.hostBadgeText}>HOST</Text>
          </View>
        )}
      </View>
      <View style={styles.list}>
        {rankings.map((r) => (
          <View key={r.rank} style={styles.row}>
            <View style={styles.rankBubble}>
              <Text style={styles.rankNumber}>{r.rank}</Text>
            </View>
            <Text style={styles.itemTitle} numberOfLines={1}>{r.title}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.soft,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    ...typography.bodyBold,
    color: colors.charcoal,
    flex: 1,
  },
  hostBadge: {
    backgroundColor: colors.amberLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  hostBadgeText: {
    ...typography.tiny,
    color: colors.amber,
    fontSize: 9,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rankBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.coralLight,
    alignItems: "center",
    justifyContent: "center",
  },
  rankNumber: {
    ...typography.caption,
    color: colors.coral,
    fontWeight: "700",
  },
  itemTitle: {
    ...typography.body,
    color: colors.charcoal,
    flex: 1,
  },
});
```

- [ ] **Step 2: Update `results.tsx` to dispatch on mode**

At the top of `apps/mobile/app/room/[code]/results.tsx`, the existing code expects vote-mode results. Refactor to branch on the response's `mode` field.

Read the file end-to-end first; here are the surgical changes:

Replace the imports + type extraction block at the top:

```tsx
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { getResults, getRoom, type ResultsResponse } from "../../../lib/api";
import { getVoterId, clearActiveRoom } from "../../../lib/storage";
import RankPlayerCard from "../../../components/RankPlayerCard";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

type RevealedVoteResults = Extract<ResultsResponse, { revealed: true; results: any[] }>;
type RevealedRankResults = Extract<ResultsResponse, { revealed: true; mode: "rank" }>;
```

Replace the component body with:

```tsx
export default function ResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [voteData, setVoteData] = useState<RevealedVoteResults | null>(null);
  const [rankData, setRankData] = useState<RevealedRankResults | null>(null);
  const [myVoterId, setMyVoterId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResults = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      setMyVoterId(voterId);
      // Hit /results with voterId so rank results sort the requester first.
      const res = await getResults(code);
      if (!res.revealed) {
        setError("Results aren't ready yet. Waiting for everyone to finish.");
      } else if ("mode" in res && res.mode === "rank") {
        setRankData(res);
      } else {
        setVoteData(res as RevealedVoteResults);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadResults();
    clearActiveRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
        <Text style={styles.loadingText}>Loading results...</Text>
      </View>
    );
  }

  if (error || (!voteData && !rankData)) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error ?? "Results not available yet"}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          onPress={loadResults}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.homeLink, pressed && { opacity: 0.6 }]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.homeLinkText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  if (rankData) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: spacing.xxl }}>
        <Animated.Text entering={FadeInUp.duration(400)} style={styles.rankTopic}>
          {rankData.topic}
        </Animated.Text>
        <Text style={styles.rankMeta}>{rankData.players.length} players ranked</Text>
        <View style={styles.rankList}>
          {rankData.players.map((p, i) => (
            <Animated.View key={p.voterId} entering={FadeInDown.duration(400).delay(i * 80)}>
              <RankPlayerCard
                name={p.name}
                isYou={p.voterId === myVoterId}
                isCreator={p.isCreator}
                rankings={p.rankings}
              />
            </Animated.View>
          ))}
        </View>
        <Pressable
          style={({ pressed }) => [styles.homeLink, pressed && { opacity: 0.6 }]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.homeLinkText}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Vote-mode results: keep the existing UI exactly as it was.
  return renderVoteResults(voteData!, insets, router);
}
```

Move the existing vote-mode JSX (the winner card + topic + FlatList + everything) into a helper `renderVoteResults(data, insets, router)` so it's preserved verbatim. Add it below the component:

```tsx
function renderVoteResults(
  data: RevealedVoteResults,
  insets: ReturnType<typeof useSafeAreaInsets>,
  router: ReturnType<typeof useRouter>
) {
  const winner = data.results[0];
  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {/* ...the existing winner card and FlatList JSX, unchanged... */}
    </View>
  );
}
```

Add the new styles for the rank reveal at the bottom of the StyleSheet:

```ts
const styles = StyleSheet.create({
  // ...existing styles preserved...
  rankTopic: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  rankMeta: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  rankList: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
});
```

(Leave all existing style keys in place — the vote-mode rendering still uses them.)

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/components/RankPlayerCard.tsx apps/mobile/app/room/[code]/results.tsx
git commit -m "feat(mobile): results screen renders blind-rank reveal alongside vote reveal"
```

---

### Task 16: Manual cross-platform smoke test

**Files:** none.

- [ ] **Step 1: Start API and mobile**

In one terminal:

```bash
cd apps/api && npx wrangler dev
```

In another:

```bash
cd apps/mobile && npx expo start
```

Choose target — iOS simulator (`i`), Android emulator (`a`), or web (`w`).

- [ ] **Step 2: Walk the creator flow**

Home → Create a Room → tap **Blind Rank** → enter "Best pizza topping" + your name → tap Create Room. On the share screen, verify the count badge says `0/5`. Add 5 items; Start button becomes enabled, says "Start Ranking". Try to type a 6th item — alert blocks. Tap Start.

Expected: lands on the rank play screen with the first item card and 5 empty slots.

- [ ] **Step 3: Verify drag and locking**

Drag the item card. Slots highlight on hover. Drop onto slot 3. Slot 3 fills with that item title and is locked. Card swaps to the next item. Drop onto slot 3 again with the next item — no effect (locked). Drop outside any slot — card springs back. Complete all 5 placements.

Expected: navigates to the waiting screen.

- [ ] **Step 4: Join from a second device/tab as a participant**

Open the app on another simulator/emulator/browser tab (web sessionStorage gives each tab its own voter ID — see `lib/storage.ts`). Tap Join, enter the code, enter a name. Land on lobby. When status flips to voting (the host already started), the lobby auto-routes to the rank screen.

Walk through 5 placements.

Expected: when the second player finishes, both move to the results screen automatically (auto-reveal). The results screen shows two player cards, "You" pinned first, with both rankings.

- [ ] **Step 5: Sanity-check vote-mode is unaffected**

Go back to home → Create → pick **Swipe Vote** → walk the existing flow end-to-end. Confirm nothing regressed.

- [ ] **Step 6: Cross-platform spot-checks**

If your primary check was on iOS, run a quick smoke test on Android and web too. Pay attention to:
- Web drag uses pointer events; confirm it feels responsive
- Slot hit-testing is accurate across screen sizes
- The host badge appears correctly in the reveal

- [ ] **Step 7: No code change**

This task ships verification only. If you found regressions, file follow-up tasks; otherwise proceed.

---

### Task 17: Final wrap-up

**Files:** none — verification + housekeeping.

- [ ] **Step 1: Confirm migration order is clean**

```bash
ls apps/api/migrations/
```

Expected: `0001_init.sql`, `0002_drop_expected_count.sql`, `0003_add_participants.sql`, `0004_collaborative_lists.sql`, `0005_blind_rank_mode.sql`.

- [ ] **Step 2: Confirm production migration when ready**

The user will deploy when they're satisfied with local. Document the command they'll run:

```bash
cd apps/api
npx wrangler d1 migrations apply tot-db --remote
npx wrangler deploy
```

Do NOT run this without explicit user approval — deploying touches the production DB.

- [ ] **Step 3: Update CLAUDE.md mode reference (optional)**

If time permits and CLAUDE.md needs an update to reflect the second mode, add a brief "Game modes" section near the existing schema doc explaining the `mode` field and pointing at the spec. Skip if the user prefers to keep CLAUDE.md focused on what's stable.

---

## Self-review checklist

- Spec section on **user flow** — covered by Tasks 8-10, 13, 14 (mode picker, create form, share, lobby, waiting label).
- Spec section on **screens (mode picker, rank play, reveal, waiting)** — covered by Tasks 8, 11, 12, 15.
- Spec section on **data model** — Task 1.
- Spec section on **API (existing endpoint additions)** — Tasks 2, 3, 5.
- Spec section on **API (new rankings endpoints)** — Task 4.
- Spec section on **reveal trigger / mode-mismatch errors** — Tasks 3, 4, 5.
- Spec section on **behavior notes (resume, late joiners, allow_suggestions force-off)** — Tasks 2, 12.
- Spec section on **validation summary** — Tasks 2, 4.
- Spec section on **testing** — Tasks 6, 16.
- Spec **file layout** matches Task list file map.

No placeholders, no `TODO`s in the steps. Function names are consistent across tasks (`getNextRankItem`, `getRankingsByRoomAndVoter`, `getRankingsByRoom`, `maybeRevealRank`, `submitRanking`, `RankCard`, `RankSlot`, `RankPlayerCard`).
