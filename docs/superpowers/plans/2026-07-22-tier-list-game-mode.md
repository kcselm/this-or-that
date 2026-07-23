# Tier List Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth game mode (Tier List) alongside Swipe Vote, Blind Rank, Bracket, and Most Likely To. The host adds 3–12 items; every player (host included) drags all items into an S/A/B/C/D board, then locks it in. When everyone has locked in, each item's tier is averaged into one Consensus board, and the reveal lets players switch between the Consensus board and each player's individual board.

**Architecture:** Reuse the existing per-mode dispatch pattern. Add a `tier_placements` table (the `rooms.mode` column already exists). Mode-specific write logic lives in a new `routes/tiers.ts` (submit only); `routes/results.ts` gains a `tier` branch for `/status` and `/results`; `routes/rooms.ts` gains tier-aware create/item-cap/start/GET logic. On mobile, a new `app/room/[code]/tier.tsx` play screen and new `components/Tier*.tsx` render the board; existing screens dispatch on `mode` at navigation boundaries (share, lobby, waiting, results, home-rejoin).

**Tech Stack:** Hono on Cloudflare Workers + D1 SQLite (API). Expo Router + React Native + react-native-gesture-handler + react-native-reanimated (mobile, cross-platform iOS/Android/web).

**Reference spec:** `docs/superpowers/specs/2026-07-22-tier-list-game-mode-design.md`

**Testing note:** This project has no automated test infrastructure (per CLAUDE.md: "add after MVP"), matching how the four existing modes shipped. Each task uses manual verification (curl + `wrangler dev` for API, `npx expo start` + on-device checks for mobile) and a `tsc --noEmit` compile-check. Do NOT introduce a test framework unless the user asks.

## Global Constraints

- **Item count (tier rooms):** minimum 3, maximum 12. Start disabled below 3; item input blocked at 12.
- **Tiers:** exactly five, fixed labels `S`, `A`, `B`, `C`, `D`. No custom/variable tiers.
- **Tier→value mapping (server-authoritative):** `S=5, A=4, B=3, C=2, D=1`. Average per item, then `Math.round` (which rounds an exact `.5` up toward the higher value, i.e. toward S). Map the rounded value back: `5→S, 4→A, 3→B, 2→C, 1→D`.
- **Within-tier ordering (Consensus):** items sorted by exact average descending, ties broken by original `sort_order` ascending.
- **Commit model:** arrange freely client-side, then a single **"Lock in my board"** submit of all placements. No per-move server writes. In-progress board persists to AsyncStorage/sessionStorage keyed by room code; the server holds no partial state.
- **allow_suggestions:** forced off for tier rooms at creation; `PATCH /settings` rejects enabling it.
- **Auto-reveal:** when participants ≥ 2 and every participant has a placement for every item.
- **Mode string:** `"tier"` everywhere (DB `rooms.mode`, API validation, mobile `RoomMode` unions).
- **DB name for migrations:** `tot-db`. Next migration number: `0008`.
- **Path conventions:** components import theme/tiers via `../lib/...`; screens under `app/room/[code]/` import via `../../../lib/...` and `../../../components/...`.

---

## File map

**API — modify:**
- `apps/api/src/db/queries.ts` — add `TierPlacement` type + helpers; add `"tier"` to `Room.mode`
- `apps/api/src/db/schema.sql` — mirror the new table + indexes
- `apps/api/src/routes/rooms.ts` — accept `mode: 'tier'`; force suggestions off; item cap 12; start validation 3–12; GET returns items + `myTiers`; PATCH rejects suggestions
- `apps/api/src/routes/votes.ts` — reject tier rooms
- `apps/api/src/routes/results.ts` — `tier` branch for `/status` and `/results` (consensus + players)
- `apps/api/src/index.ts` — mount tiers router

**API — create:**
- `apps/api/migrations/0008_tier_list_mode.sql`
- `apps/api/src/routes/tiers.ts` — `POST /:code/tiers` (bulk board submit + auto-reveal)

**Mobile — modify:**
- `apps/mobile/lib/api.ts` — `"tier"` in mode unions; `myTiers`; `submitTierBoard`; tier results types
- `apps/mobile/lib/storage.ts` — tier draft helpers
- `apps/mobile/app/create/mode.tsx` — Tier List card
- `apps/mobile/app/create/index.tsx` — accept `mode='tier'`
- `apps/mobile/app/create/share.tsx` — tier item cap (12), start gate (3–12), nav, button label
- `apps/mobile/app/_layout.tsx` — register `room/[code]/tier`
- `apps/mobile/app/room/[code]/lobby.tsx` — dispatch to tier on voting
- `apps/mobile/app/room/[code]/waiting.tsx` — `"Sorting..."` label for tier
- `apps/mobile/app/room/[code]/results.tsx` — tier reveal branch
- `apps/mobile/app/index.tsx` — home-rejoin dispatch to tier

**Mobile — create:**
- `apps/mobile/lib/tiers.ts` — tier constants + colors
- `apps/mobile/components/TierChip.tsx` — draggable/tappable item pill (play)
- `apps/mobile/components/TierRow.tsx` — a zone (tier row or pool) drop target that measures its rect (play)
- `apps/mobile/components/TierBoard.tsx` — static S/A/B/C/D board (reveal)
- `apps/mobile/app/room/[code]/tier.tsx` — drag/tap play screen + lock-in

---

## Phase A — API

### Task 1: Migration, types, query helpers

**Files:**
- Create: `apps/api/migrations/0008_tier_list_mode.sql`
- Modify: `apps/api/src/db/schema.sql`
- Modify: `apps/api/src/db/queries.ts`

**Interfaces:**
- Produces: `TierPlacement` type; `getTierPlacementsByRoom(db, roomId): Promise<TierPlacement[]>`; `getTierPlacementsByVoter(db, roomId, voterId): Promise<TierPlacement[]>`; `Room.mode` now includes `"tier"`.

- [ ] **Step 1: Write the migration**

Create `apps/api/migrations/0008_tier_list_mode.sql`:

```sql
CREATE TABLE tier_placements (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('S','A','B','C','D')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);

CREATE INDEX idx_tier_placements_room ON tier_placements(room_id);
CREATE INDEX idx_tier_placements_room_voter ON tier_placements(room_id, voter_id);
```

- [ ] **Step 2: Mirror the table in `apps/api/src/db/schema.sql`**

In `apps/api/src/db/schema.sql`, immediately after the `mlt_votes` table block (ends at its closing `);`) and before the `-- Indexes` comment, add:

```sql
-- Tier list placements (tier mode; one per voter per item)
CREATE TABLE tier_placements (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('S','A','B','C','D')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);
```

Then at the very end of the file, after the last existing `CREATE INDEX idx_mlt_votes_room_voter ...` line, add:

```sql
CREATE INDEX idx_tier_placements_room ON tier_placements(room_id);
CREATE INDEX idx_tier_placements_room_voter ON tier_placements(room_id, voter_id);
```

- [ ] **Step 3: Apply the migration locally**

```bash
cd apps/api
npx wrangler d1 migrations apply tot-db --local
```

Expected: output lists `0008_tier_list_mode.sql` under "Migrations to be applied" and reports success.

- [ ] **Step 4: Add `"tier"` to the `Room.mode` union in `apps/api/src/db/queries.ts`**

Find (near the top of the file):

```ts
  mode: "vote" | "rank" | "bracket" | "mlt";
```

Replace with:

```ts
  mode: "vote" | "rank" | "bracket" | "mlt" | "tier";
```

- [ ] **Step 5: Add the `TierPlacement` type and helpers at the bottom of `apps/api/src/db/queries.ts`**

Append to the end of the file:

```ts
export type TierPlacement = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  tier: "S" | "A" | "B" | "C" | "D";
  created_at: string;
};

export async function getTierPlacementsByRoom(
  db: D1Database,
  roomId: string
): Promise<TierPlacement[]> {
  const { results } = await db
    .prepare("SELECT * FROM tier_placements WHERE room_id = ?")
    .bind(roomId)
    .all<TierPlacement>();
  return results;
}

export async function getTierPlacementsByVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<TierPlacement[]> {
  const { results } = await db
    .prepare("SELECT * FROM tier_placements WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<TierPlacement>();
  return results;
}
```

- [ ] **Step 6: Compile-check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations/0008_tier_list_mode.sql apps/api/src/db/schema.sql apps/api/src/db/queries.ts
git commit -m "$(cat <<'EOF'
feat(api): add migration, types, queries for tier list mode

- 0008 migration: tier_placements table with UNIQUE(item,voter).
- Mirror in schema.sql so fresh DBs match migrated ones.
- Add 'tier' to Room.mode; add TierPlacement type and
  getTierPlacementsByRoom / getTierPlacementsByVoter helpers.
EOF
)"
```

---

### Task 2: `routes/rooms.ts` — tier-aware create, items, start, GET, settings

**Files:**
- Modify: `apps/api/src/routes/rooms.ts`

**Interfaces:**
- Consumes: `getTierPlacementsByVoter` from Task 1.
- Produces: `POST /rooms` accepts `mode:'tier'`; `GET /:code` returns `myTiers` for tier rooms.

- [ ] **Step 1: Import the new query helper**

Find the import line at the top:

```ts
import { getRoomByCode, getItemsByRoomId, getItemCount, getVotesByRoomAndVoter, getRankingsByRoomAndVoter, getMltVotesByVoter } from "../db/queries";
```

Replace with:

```ts
import { getRoomByCode, getItemsByRoomId, getItemCount, getVotesByRoomAndVoter, getRankingsByRoomAndVoter, getMltVotesByVoter, getTierPlacementsByVoter } from "../db/queries";
```

- [ ] **Step 2: Accept `mode: 'tier'` and force suggestions off (in `POST /`)**

Find:

```ts
  const mode = body.mode ?? "vote";
  if (
    mode !== "vote" &&
    mode !== "rank" &&
    mode !== "bracket" &&
    mode !== "mlt"
  ) {
    return validationError("mode must be 'vote', 'rank', 'bracket', or 'mlt'");
  }
```

Replace with:

```ts
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
```

Find:

```ts
  const allowSuggestions = (mode === "rank" || mode === "bracket") ? 0 : (body.allowSuggestions ? 1 : 0);
```

Replace with:

```ts
  const allowSuggestions = (mode === "rank" || mode === "bracket" || mode === "tier") ? 0 : (body.allowSuggestions ? 1 : 0);
```

- [ ] **Step 3: Cap tier rooms at 12 items and block participant adds (in `POST /:code/items`)**

Find:

```ts
  if (!isCreator && (room.mode === "rank" || room.mode === "bracket")) {
    return invalidStatus(
      room.mode === "rank"
        ? "Participants cannot add items in a blind rank room"
        : "Participants cannot add items in a bracket room"
    );
  }

  const maxItems =
    room.mode === "rank" ? 5 :
    room.mode === "bracket" ? 16 : 15;
```

Replace with:

```ts
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
```

- [ ] **Step 4: Validate 3–12 items on start (in `POST /:code/start`)**

Find:

```ts
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
  } else {
```

Replace with:

```ts
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
```

No change to the status-transition block: tier is neither `rank` nor `bracket`, so it falls into the existing final `else` that just flips `status` to `voting`. (Pool shuffling is done client-side per player; no `presentation_order` is set for tier rooms.)

- [ ] **Step 5: Return items + `myTiers` for tier rooms (in `GET /:code`)**

Find:

```ts
  const showItemsForMltMode =
    room.mode === "mlt" && (room.status !== "open" || isCreator);
  if (
    showItemsForVoteMode ||
    showItemsForRankMode ||
    showItemsForBracketMode ||
    showItemsForMltMode
  ) {
```

Replace with:

```ts
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
```

Then find the `myMltVotes` block:

```ts
    if (room.mode === "mlt") {
      const mltVotes = await getMltVotesByVoter(db, room.id, voterId);
      const myMltVotes: Record<string, string> = {};
      for (const v of mltVotes) {
        myMltVotes[v.item_id] = v.target_voter_id;
      }
      response.myMltVotes = myMltVotes;
    }
  }
```

Replace with:

```ts
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
```

- [ ] **Step 6: Reject enabling suggestions on tier rooms (in `PATCH /:code/settings`)**

Find:

```ts
  if (room.mode === "bracket" && allowSuggestions === true) {
    return invalidStatus("Item suggestions are not available in bracket rooms");
  }
```

Replace with:

```ts
  if (room.mode === "bracket" && allowSuggestions === true) {
    return invalidStatus("Item suggestions are not available in bracket rooms");
  }
  if (room.mode === "tier" && allowSuggestions === true) {
    return invalidStatus("Item suggestions are not available in tier list rooms");
  }
```

- [ ] **Step 7: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/rooms.ts
git commit -m "$(cat <<'EOF'
feat(api): tier-aware rooms routes

- POST /rooms accepts mode 'tier' and forces allow_suggestions off.
- POST /:code/items caps tier rooms at 12 and blocks participant adds.
- POST /:code/start requires 3-12 items for tier rooms.
- GET /:code returns items for tier rooms and myTiers alongside myVotes.
- PATCH /:code/settings rejects enabling suggestions on tier rooms.
EOF
)"
```

---

### Task 3: Reject vote submissions on tier rooms

**Files:**
- Modify: `apps/api/src/routes/votes.ts`

- [ ] **Step 1: Add the mode guard**

Find:

```ts
  if (room.mode === "mlt") {
    return validationError("This is a Most Likely To room — use /mlt-votes instead of /votes");
  }
```

Replace with:

```ts
  if (room.mode === "mlt") {
    return validationError("This is a Most Likely To room — use /mlt-votes instead of /votes");
  }
  if (room.mode === "tier") {
    return validationError("This is a tier list room — use /tiers instead of /votes");
  }
```

(`rankings.ts`, `bracket.ts`, and `mlt.ts` already reject any non-matching mode via `room.mode !== "..."`, so tier submissions are already rejected there — no change needed.)

- [ ] **Step 2: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/votes.ts
git commit -m "feat(api): reject vote submissions on tier-mode rooms"
```

---

### Task 4: Create `routes/tiers.ts` — board submit + auto-reveal

**Files:**
- Create: `apps/api/src/routes/tiers.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `getRoomByCode`, `getItemsByRoomId` from `queries.ts`; `notFound`, `invalidStatus`, `validationError` from `validation.ts`.
- Produces: `POST /api/rooms/:code/tiers` returning `{ success, progress: { placed, total }, isRevealed }`; exports `tiers` router.

- [ ] **Step 1: Write the router file**

Create `apps/api/src/routes/tiers.ts`:

```ts
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
```

- [ ] **Step 2: Mount the router in `apps/api/src/index.ts`**

Find:

```ts
import { mlt, mltPrompts } from "./routes/mlt";
```

Add below it:

```ts
import { tiers } from "./routes/tiers";
```

Find:

```ts
app.route("/api/rooms", mlt);
app.route("/api/mlt", mltPrompts);
```

Replace with:

```ts
app.route("/api/rooms", mlt);
app.route("/api/rooms", tiers);
app.route("/api/mlt", mltPrompts);
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/tiers.ts apps/api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): add tiers router for tier-list board submit

- POST /:code/tiers validates a full board (every item placed once,
  tiers in S/A/B/C/D), inserts all placements atomically, and relies on
  UNIQUE(item,voter) to reject a double lock-in.
- Auto-reveal when >=2 participants have each locked in a full board.
EOF
)"
```

---

### Task 5: `routes/results.ts` — tier `/status` and `/results`

**Files:**
- Modify: `apps/api/src/routes/results.ts`

**Interfaces:**
- Consumes: `getItemsByRoomId`, `getTierPlacementsByRoom`, `Room` from `queries.ts`.
- Produces: `GET /:code/results` returns `{ revealed, mode:'tier', topic, consensus, players }` for tier rooms; `/status` counts tier completion.

- [ ] **Step 1: Import the tier placement helper**

Find:

```ts
import {
  getRoomByCode,
  getItemsByRoomId,
  getItemCount,
  getRankingsByRoom,
  getMatchupsByRoom,
  getMatchupsByRoomAndRound,
  getMatchupVotesByRoom,
  getCurrentRound,
  type Room,
  type Matchup,
} from "../db/queries";
```

Replace with:

```ts
import {
  getRoomByCode,
  getItemsByRoomId,
  getItemCount,
  getRankingsByRoom,
  getMatchupsByRoom,
  getMatchupsByRoomAndRound,
  getMatchupVotesByRoom,
  getCurrentRound,
  getTierPlacementsByRoom,
  type Room,
  type Matchup,
} from "../db/queries";
```

- [ ] **Step 2: Add tier to the `/status` completion logic**

Find:

```ts
  if (room.mode === "rank") {
    submissionsTable = "rankings";
    requiredCount = 5;
  } else if (room.mode === "mlt") {
    submissionsTable = "mlt_votes";
    requiredCount = totalItems;
  } else {
    submissionsTable = "votes";
    requiredCount = totalItems;
  }
```

Replace with:

```ts
  if (room.mode === "rank") {
    submissionsTable = "rankings";
    requiredCount = 5;
  } else if (room.mode === "mlt") {
    submissionsTable = "mlt_votes";
    requiredCount = totalItems;
  } else if (room.mode === "tier") {
    submissionsTable = "tier_placements";
    requiredCount = totalItems;
  } else {
    submissionsTable = "votes";
    requiredCount = totalItems;
  }
```

(The `submissionsTable` value is interpolated into SQL, which is safe here because it is one of a fixed set of server-side literals, never user input.)

- [ ] **Step 3: Dispatch `/results` to a tier helper**

Find:

```ts
  if (room.mode === "mlt") {
    return getMltResults(c, db, room);
  }
  return getVoteResults(c, db, room);
});
```

Replace with:

```ts
  if (room.mode === "mlt") {
    return getMltResults(c, db, room);
  }
  if (room.mode === "tier") {
    return getTierResults(c, db, room, voterId);
  }
  return getVoteResults(c, db, room);
});
```

- [ ] **Step 4: Add the `getTierResults` helper**

At the end of `results.ts` but BEFORE the `// POST /api/rooms/:code/reveal` handler block, add:

```ts
const TIER_ORDER = ["S", "A", "B", "C", "D"] as const;
const TIER_VALUE: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
const VALUE_TIER: Record<number, "S" | "A" | "B" | "C" | "D"> = {
  5: "S",
  4: "A",
  3: "B",
  2: "C",
  1: "D",
};

async function getTierResults(
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
    const totalItems = await getItemCount(db, room.id);
    const completed = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT voter_id FROM tier_placements WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= ?
        )`
      )
      .bind(room.id, totalItems)
      .first<{ completed: number }>();

    return Response.json({
      revealed: false,
      mode: "tier",
      completedCount: completed?.completed ?? 0,
      totalVoters: totalParticipants?.count ?? 0,
    });
  }

  const items = await getItemsByRoomId(db, room.id); // sorted by sort_order ASC
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const orderById = new Map(items.map((i) => [i.id, i.sort_order]));
  const allPlacements = await getTierPlacementsByRoom(db, room.id);

  const participants = await db
    .prepare(
      "SELECT voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string }>();

  // --- Consensus: average each item's tier value across all placements. ---
  const sumByItem = new Map<string, { sum: number; count: number }>();
  for (const p of allPlacements) {
    const acc = sumByItem.get(p.item_id) ?? { sum: 0, count: 0 };
    acc.sum += TIER_VALUE[p.tier] ?? 0;
    acc.count += 1;
    sumByItem.set(p.item_id, acc);
  }

  type ConsensusItem = { itemId: string; title: string; average: number; tier: string };
  const consensusItems: ConsensusItem[] = [];
  for (const item of items) {
    const acc = sumByItem.get(item.id);
    if (!acc || acc.count === 0) continue; // no placements (shouldn't happen once revealed)
    const average = acc.sum / acc.count;
    const tier = VALUE_TIER[Math.round(average)] ?? "D";
    consensusItems.push({ itemId: item.id, title: item.title, average, tier });
  }

  const consensus = TIER_ORDER.map((tier) => ({
    tier,
    items: consensusItems
      .filter((ci) => ci.tier === tier)
      .sort((a, b) => {
        if (b.average !== a.average) return b.average - a.average;
        return (orderById.get(a.itemId) ?? 0) - (orderById.get(b.itemId) ?? 0);
      })
      .map((ci) => ({ itemId: ci.itemId, title: ci.title, average: ci.average })),
  }));

  // --- Per-player boards. ---
  type PlayerRow = {
    voterId: string;
    name: string;
    isCreator: boolean;
    placements: { itemId: string; title: string; tier: string }[];
  };
  const byVoter = new Map<string, PlayerRow>();
  for (const p of participants.results) {
    byVoter.set(p.voter_id, {
      voterId: p.voter_id,
      name: p.voter_name,
      isCreator: p.voter_id === room.creator_voter_id,
      placements: [],
    });
  }
  for (const p of allPlacements) {
    const row = byVoter.get(p.voter_id);
    if (!row) continue;
    row.placements.push({
      itemId: p.item_id,
      title: titleById.get(p.item_id) ?? "",
      tier: p.tier,
    });
  }

  const players: PlayerRow[] = [];
  for (const row of byVoter.values()) {
    if (row.placements.length === items.length) {
      row.placements.sort(
        (a, b) => (orderById.get(a.itemId) ?? 0) - (orderById.get(b.itemId) ?? 0)
      );
      players.push(row);
    }
  }

  players.sort((a, b) => {
    if (voterId && a.voterId === voterId) return -1;
    if (voterId && b.voterId === voterId) return 1;
    if (a.isCreator && !b.isCreator) return -1;
    if (b.isCreator && !a.isCreator) return 1;
    return a.name.localeCompare(b.name);
  });

  return Response.json({
    revealed: true,
    mode: "tier",
    topic: room.topic,
    consensus,
    players,
  });
}
```

- [ ] **Step 5: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/results.ts
git commit -m "$(cat <<'EOF'
feat(api): tier /status completion and /results consensus

- /status counts a tier participant complete when they have a placement
  for every item.
- /results averages each item's tier value (S=5..D=1), rounds to the
  nearest tier (.5 rounds up toward S), and returns a Consensus board
  plus each player's full board, requester sorted first.
EOF
)"
```

---

### Task 6: Manual API integration test

**Files:** none (verification only). Requires `python` on PATH for JSON extraction (same as the blind-rank plan).

- [ ] **Step 1: Start the local API**

```bash
cd apps/api
npx wrangler dev
```

Wait for `Ready on http://localhost:8787`. Run the following in a second terminal.

- [ ] **Step 2: Create a tier room**

```bash
ROOM=$(curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"Pizza toppings","mode":"tier","creatorVoterId":"host","creatorName":"Host"}' \
  | python -c "import json,sys; print(json.load(sys.stdin)['code'])")
echo "room: $ROOM"
```

Expected: a 6-char code prints. (If it errors, print the raw response to inspect.)

- [ ] **Step 3: Add items; verify the 13th is rejected and start needs ≥3**

```bash
for t in Pepperoni Mushroom Sausage Pineapple Anchovy Olives Basil Onion Ham Bacon Corn Chili; do
  curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/items" \
    -H "Content-Type: application/json" \
    -d "{\"item\":\"$t\",\"creatorVoterId\":\"host\"}" > /dev/null
done
# 13th should be rejected
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/items" \
  -H "Content-Type: application/json" \
  -d '{"item":"Extra","creatorVoterId":"host"}'
echo
```

Expected: the 13th returns `VALIDATION_ERROR` about exceeding the limit of 12.

- [ ] **Step 4: Join a second participant and start**

```bash
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/join" \
  -H "Content-Type: application/json" \
  -d '{"voterId":"bob","voterName":"Bob"}'
echo
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/start" \
  -H "Content-Type: application/json" \
  -d '{"creatorVoterId":"host"}'
echo
```

Expected: join returns `{"success":true}`; start returns `{"success":true,"status":"voting","itemCount":12,"mode":"tier"}`.

- [ ] **Step 5: Fetch items and submit a full board for each player**

```bash
# Grab the 12 item ids into a bash array.
ITEMS=$(curl -s "http://localhost:8787/api/rooms/$ROOM?voterId=host" \
  | python -c "import json,sys; print(' '.join(i['id'] for i in json.load(sys.stdin)['items']))")
read -ra IDS <<< "$ITEMS"
echo "got ${#IDS[@]} items"

submit_board() {
  local voter=$1 name=$2
  local tiers=(S A B C D S A B C D S A)  # deterministic assignment across 12 items
  local placements=""
  for i in "${!IDS[@]}"; do
    [ "$i" -gt 0 ] && placements+=","
    placements+="{\"itemId\":\"${IDS[$i]}\",\"tier\":\"${tiers[$i]}\"}"
  done
  curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/tiers" \
    -H "Content-Type: application/json" \
    -d "{\"voterId\":\"$voter\",\"voterName\":\"$name\",\"placements\":[$placements]}"
  echo
}

submit_board host Host
submit_board bob Bob
```

Expected: each returns `{"success":true,"progress":{"placed":12,"total":12},"isRevealed":...}`. The second submit shows `"isRevealed":true`.

- [ ] **Step 6: Verify results shape**

```bash
curl -s "http://localhost:8787/api/rooms/$ROOM/results?voterId=bob" | python -m json.tool
```

Expected: `"revealed": true`, `"mode": "tier"`, a `consensus` array of 5 objects (tiers S..D, each with an `items` array), and a `players` array of 2 boards with Bob first. Items placed in tier S by both (indices 0,5,10 → S) should land in consensus tier S.

- [ ] **Step 7: Verify guards**

```bash
# double lock-in
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/tiers" \
  -H "Content-Type: application/json" \
  -d "{\"voterId\":\"bob\",\"voterName\":\"Bob\",\"placements\":[{\"itemId\":\"${IDS[0]}\",\"tier\":\"S\"}]}"
echo
# vote endpoint on tier room
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/votes" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"x","voterId":"bob","voterName":"Bob","vote":"yes"}'
echo
```

Expected: first returns a `VALIDATION_ERROR` (already locked in OR not voting — room is revealed); second returns a `VALIDATION_ERROR` mentioning tier/`/tiers`.

- [ ] **Step 8: Sanity-check an existing mode still works**

```bash
VOTE=$(curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"test","creatorVoterId":"vh","creatorName":"VH"}' \
  | python -c "import json,sys; print(json.load(sys.stdin)['code'])")
for t in A B C; do
  curl -s -X POST "http://localhost:8787/api/rooms/$VOTE/items" \
    -H "Content-Type: application/json" -d "{\"item\":\"$t\",\"creatorVoterId\":\"vh\"}" > /dev/null
done
curl -s -X POST "http://localhost:8787/api/rooms/$VOTE/start" \
  -H "Content-Type: application/json" -d '{"creatorVoterId":"vh"}'
echo
```

Expected: `{"success":true,"status":"voting","itemCount":3,"mode":"vote"}`. No code change; verification only.

---

## Phase B — Mobile

### Task 7: `lib/api.ts` — mode unions, `myTiers`, submit + results types

**Files:**
- Modify: `apps/mobile/lib/api.ts`

**Interfaces:**
- Produces: `Tier` type; `submitTierBoard(code, body)`; `TierResultsResponse`; `myTiers` on `RoomResponse`. Consumed by Tasks 10, 12, 14.

- [ ] **Step 1: Add `"tier"` to every mode union**

There are three occurrences of `"vote" | "rank" | "bracket" | "mlt"` (in `CreateRoomResponse.mode`, the `createRoom` body param, and `RoomResponse.mode`). Replace all three with `"vote" | "rank" | "bracket" | "mlt" | "tier"`.

- [ ] **Step 2: Add `myTiers` to `RoomResponse`**

Find:

```ts
  myVotes?: Record<string, string>;
  myRankings?: Record<string, number>;
  myMltVotes?: Record<string, string>;
};
```

Replace with:

```ts
  myVotes?: Record<string, string>;
  myRankings?: Record<string, number>;
  myMltVotes?: Record<string, string>;
  myTiers?: Record<string, string>;
};
```

- [ ] **Step 3: Add the tier submit function + result types at the bottom of the file**

Append:

```ts
// --- Tier list endpoints (tier mode) ---

export type Tier = "S" | "A" | "B" | "C" | "D";

export type TierPlacementInput = { itemId: string; tier: Tier };

export type SubmitTierBoardResponse = {
  success: boolean;
  progress: { placed: number; total: number };
  isRevealed: boolean;
};

export function submitTierBoard(
  code: string,
  body: { voterId: string; voterName: string; placements: TierPlacementInput[] }
) {
  return request<SubmitTierBoardResponse>(`/rooms/${code}/tiers`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type TierConsensusRow = {
  tier: Tier;
  items: { itemId: string; title: string; average: number }[];
};

export type TierPlayerBoard = {
  voterId: string;
  name: string;
  isCreator: boolean;
  placements: { itemId: string; title: string; tier: Tier }[];
};

export type TierResultsResponse =
  | {
      revealed: true;
      mode: "tier";
      topic: string;
      consensus: TierConsensusRow[];
      players: TierPlayerBoard[];
    }
  | {
      revealed: false;
      mode: "tier";
      completedCount: number;
      totalVoters: number;
    };
```

- [ ] **Step 4: Add `TierResultsResponse` to the `ResultsResponse` union**

Find:

```ts
  | RankResultsResponse
  | BracketResultsResponse
  | MltResultsRevealed
  | MltResultsPending;
```

Replace with:

```ts
  | RankResultsResponse
  | BracketResultsResponse
  | MltResultsRevealed
  | MltResultsPending
  | TierResultsResponse;
```

Note: `TierResultsResponse` is referenced in the union above its own declaration. That is fine — TypeScript `type` aliases are hoisted, so ordering does not matter. (If you prefer, move the tier type block above the `ResultsResponse` union.)

- [ ] **Step 5: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/lib/api.ts
git commit -m "feat(mobile-api): tier mode types, submitTierBoard, tier results"
```

---

### Task 8: `lib/tiers.ts` constants + `lib/storage.ts` draft helpers

**Files:**
- Create: `apps/mobile/lib/tiers.ts`
- Modify: `apps/mobile/lib/storage.ts`

**Interfaces:**
- Produces: `TIERS`, `TIER_META`, `type TierZone`; `saveTierDraft`, `getTierDraft`, `clearTierDraft`. Consumed by Tasks 11, 12, 14.

- [ ] **Step 1: Create `apps/mobile/lib/tiers.ts`**

```ts
import type { Tier } from "./api";

export const TIERS: Tier[] = ["S", "A", "B", "C", "D"];

// A chip lives in a tier or in the unplaced pool.
export type TierZone = Tier | "pool";

export const TIER_META: Record<
  Tier,
  { label: string; badge: string; text: string; rowBg: string }
> = {
  S: { label: "S", badge: "#E5484D", text: "#FFFFFF", rowBg: "#FDEEEE" },
  A: { label: "A", badge: "#F76B15", text: "#FFFFFF", rowBg: "#FDF0E6" },
  B: { label: "B", badge: "#F5A623", text: "#FFFFFF", rowBg: "#FDF6E7" },
  C: { label: "C", badge: "#3FA45B", text: "#FFFFFF", rowBg: "#EBF6EE" },
  D: { label: "D", badge: "#3E7BB6", text: "#FFFFFF", rowBg: "#EAF1F8" },
};
```

- [ ] **Step 2: Add draft helpers to `apps/mobile/lib/storage.ts`**

At the end of the file, append:

```ts
// --- Tier list in-progress board draft (local only, keyed by room code) ---

function tierDraftKey(code: string): string {
  return `tot_tier_draft_${code.toUpperCase()}`;
}

export async function saveTierDraft(
  code: string,
  placement: Record<string, string>
): Promise<void> {
  const json = JSON.stringify(placement);
  if (Platform.OS === "web") {
    sessionStorage.setItem(tierDraftKey(code), json);
    return;
  }
  await AsyncStorage.setItem(tierDraftKey(code), json);
}

export async function getTierDraft(
  code: string
): Promise<Record<string, string> | null> {
  let json: string | null;
  if (Platform.OS === "web") {
    json = sessionStorage.getItem(tierDraftKey(code));
  } else {
    json = await AsyncStorage.getItem(tierDraftKey(code));
  }
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function clearTierDraft(code: string): Promise<void> {
  if (Platform.OS === "web") {
    sessionStorage.removeItem(tierDraftKey(code));
    return;
  }
  await AsyncStorage.removeItem(tierDraftKey(code));
}
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/lib/tiers.ts apps/mobile/lib/storage.ts
git commit -m "feat(mobile): tier constants/colors + local board draft helpers"
```

---

### Task 9: Mode picker card + create screen accepts tier

**Files:**
- Modify: `apps/mobile/app/create/mode.tsx`
- Modify: `apps/mobile/app/create/index.tsx`

- [ ] **Step 1: Add the Tier List card in `create/mode.tsx`**

Find the closing of the MLT card's `Animated.View` (the last mode card) — the block that ends:

```tsx
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}
```

Replace with:

```tsx
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(500).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardTier, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "tier" } })}
        >
          <Text style={styles.cardEmoji}>▦</Text>
          <Text style={styles.cardTitle}>Tier List</Text>
          <Text style={styles.cardDescription}>
            Add items, then everyone drags them into S/A/B/C/D. We average the tiers into one shared board.
          </Text>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}
```

Then in the `StyleSheet.create({ ... })` at the bottom, find `cardMlt`:

```tsx
  cardMlt: {
    borderColor: "#7C6EF2", // matches PLAYER_COLORS[3].border for thematic consistency
  },
```

Add directly after it:

```tsx
  cardTier: {
    borderColor: "#3FA45B", // tier "C" green accent
  },
```

- [ ] **Step 2: Accept `mode='tier'` in `create/index.tsx`**

Find:

```tsx
  const mode: "vote" | "rank" | "bracket" | "mlt" =
    modeParam === "rank"
      ? "rank"
      : modeParam === "bracket"
        ? "bracket"
        : modeParam === "mlt"
          ? "mlt"
          : "vote";
```

Replace with:

```tsx
  const mode: "vote" | "rank" | "bracket" | "mlt" | "tier" =
    modeParam === "rank"
      ? "rank"
      : modeParam === "bracket"
        ? "bracket"
        : modeParam === "mlt"
          ? "mlt"
          : modeParam === "tier"
            ? "tier"
            : "vote";
```

No other change is needed here: the suggestions toggle is already gated on `mode === "vote"` (so it stays hidden for tier), and the post-create navigation already sends every non-mlt mode to `/create/share` with the `mode` param.

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/mode.tsx apps/mobile/app/create/index.tsx
git commit -m "feat(mobile): add Tier List mode card; create screen accepts tier mode"
```

---

### Task 10: `create/share.tsx` — tier item cap, start gate, nav, label

**Files:**
- Modify: `apps/mobile/app/create/share.tsx`

- [ ] **Step 1: Widen the `mode` state union**

Find:

```tsx
  const [mode, setMode] = useState<"vote" | "rank" | "bracket" | "mlt">(
    modeParam === "rank" ? "rank" : modeParam === "bracket" ? "bracket" : modeParam === "mlt" ? "mlt" : "vote"
  );
```

Replace with:

```tsx
  const [mode, setMode] = useState<"vote" | "rank" | "bracket" | "mlt" | "tier">(
    modeParam === "rank" ? "rank" : modeParam === "bracket" ? "bracket" : modeParam === "mlt" ? "mlt" : modeParam === "tier" ? "tier" : "vote"
  );
```

- [ ] **Step 2: Add the tier cap and start gate**

Find:

```tsx
  const maxItems =
    mode === "rank" ? 5 :
    mode === "bracket" ? 16 : 15;
  const canStart =
    mode === "rank" ? items.length === 5 :
    mode === "bracket" ? items.length >= 4 && items.length <= 16 :
    mode === "mlt" ? items.length >= 3 && items.length <= 15 && participants.length >= 3 :
    items.length >= 2;
```

Replace with:

```tsx
  const maxItems =
    mode === "rank" ? 5 :
    mode === "bracket" ? 16 :
    mode === "tier" ? 12 : 15;
  const canStart =
    mode === "rank" ? items.length === 5 :
    mode === "bracket" ? items.length >= 4 && items.length <= 16 :
    mode === "mlt" ? items.length >= 3 && items.length <= 15 && participants.length >= 3 :
    mode === "tier" ? items.length >= 3 && items.length <= 12 :
    items.length >= 2;
```

- [ ] **Step 3: Add tier to the "not ready" alert**

Find:

```tsx
        mode === "mlt"
          ? "Most Likely To needs at least 3 prompts and 3 participants"
          : "Add at least 2 items to start voting"
```

Replace with:

```tsx
        mode === "mlt"
          ? "Most Likely To needs at least 3 prompts and 3 participants"
          : mode === "tier"
          ? "Tier list rooms need between 3 and 12 items"
          : "Add at least 2 items to start voting"
```

- [ ] **Step 4: Route to the tier play screen on start**

Find:

```tsx
        pathname:
          mode === "rank" ? "/room/[code]/rank" :
          mode === "bracket" ? "/room/[code]/bracket" :
          mode === "mlt" ? "/room/[code]/mlt" :
          "/room/[code]/swipe",
```

Replace with:

```tsx
        pathname:
          mode === "rank" ? "/room/[code]/rank" :
          mode === "bracket" ? "/room/[code]/bracket" :
          mode === "mlt" ? "/room/[code]/mlt" :
          mode === "tier" ? "/room/[code]/tier" :
          "/room/[code]/swipe",
```

- [ ] **Step 5: Update the Start button label**

Find:

```tsx
              : mode === "mlt"
              ? "Start Game"
              : "Start Voting"}
```

Replace with:

```tsx
              : mode === "mlt"
              ? "Start Game"
              : mode === "tier"
              ? "Start Tier List"
              : "Start Voting"}
```

- [ ] **Step 6: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/share.tsx
git commit -m "feat(mobile): share screen caps tier at 12, gates start 3-12, routes to tier screen"
```

---

### Task 11: Tier play components — `TierChip.tsx` and `TierRow.tsx`

**Files:**
- Create: `apps/mobile/components/TierChip.tsx`
- Create: `apps/mobile/components/TierRow.tsx`

`TierChip` is a draggable + tappable item pill. `TierRow` is a zone (a tier row or the pool) that measures its on-screen rect and renders the chips currently in that zone. The play screen (Task 12) coordinates hit-testing and state.

**Interfaces:**
- Produces: `TierChip` (default export) with props `{ id, title, badgeColor, selected, onTap, onDragMove, onDragEnd }`; `TierRow` (default export) with props `{ zone, label, labelColor, labelText, rowBg, highlighted, selectable, onPress, onMeasure, children }`; and `type ZoneRect`.

- [ ] **Step 1: Create `TierChip.tsx`**

```tsx
import { StyleSheet, Text } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { colors, radius, spacing, typography, shadows } from "../lib/theme";

type Props = {
  id: string;
  title: string;
  badgeColor: string;
  selected: boolean;
  onTap: (id: string) => void;
  onDragMove: (id: string, absX: number, absY: number) => void;
  onDragEnd: (id: string, absX: number, absY: number) => void;
};

export default function TierChip({
  id,
  title,
  badgeColor,
  selected,
  onTap,
  onDragMove,
  onDragEnd,
}: Props) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const active = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      active.value = 1;
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      runOnJS(onDragMove)(id, e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      runOnJS(onDragEnd)(id, e.absoluteX, e.absoluteY);
      translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      active.value = 0;
    });

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onTap)(id);
  });

  const gesture = Gesture.Race(tap, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
    zIndex: active.value ? 999 : 1,
    elevation: active.value ? 12 : 2,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.chip,
          { borderColor: badgeColor },
          selected && styles.chipSelected,
          animatedStyle,
        ]}
      >
        <Text style={styles.chipText} numberOfLines={1}>
          {title}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.pill,
    borderWidth: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    maxWidth: 160,
    ...shadows.soft,
  },
  chipSelected: {
    backgroundColor: colors.sandLight,
    transform: [{ scale: 1.05 }],
  },
  chipText: {
    ...typography.caption,
    color: colors.charcoal,
    fontWeight: "700",
  },
});
```

- [ ] **Step 2: Create `TierRow.tsx`**

```tsx
import { useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent,
} from "react-native";
import { colors, radius, spacing, typography } from "../lib/theme";
import type { TierZone } from "../lib/tiers";

export type ZoneRect = { x: number; y: number; width: number; height: number };

type Props = {
  zone: TierZone;
  labelText: string;
  labelColor: string;
  labelTextColor: string;
  rowBg: string;
  highlighted: boolean;
  selectable: boolean;
  onPress: (zone: TierZone) => void;
  onMeasure: (zone: TierZone, rect: ZoneRect) => void;
  children: React.ReactNode;
};

export default function TierRow({
  zone,
  labelText,
  labelColor,
  labelTextColor,
  rowBg,
  highlighted,
  selectable,
  onPress,
  onMeasure,
  children,
}: Props) {
  const ref = useRef<View>(null);

  const handleLayout = (_: LayoutChangeEvent) => {
    ref.current?.measureInWindow((x, y, width, height) => {
      onMeasure(zone, { x, y, width, height });
    });
  };

  return (
    <Pressable
      onPress={() => selectable && onPress(zone)}
      disabled={!selectable}
    >
      <View
        ref={ref}
        onLayout={handleLayout}
        style={[
          styles.row,
          { backgroundColor: rowBg },
          highlighted && styles.rowHighlighted,
        ]}
      >
        <View style={[styles.label, { backgroundColor: labelColor }]}>
          <Text style={[styles.labelText, { color: labelTextColor }]}>
            {labelText}
          </Text>
        </View>
        <View style={styles.chips}>{children}</View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    minHeight: 52,
    borderWidth: 2,
    borderColor: "transparent",
  },
  rowHighlighted: {
    borderColor: colors.charcoal,
  },
  label: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: radius.md - 2,
    borderBottomLeftRadius: radius.md - 2,
  },
  labelText: {
    fontSize: 20,
    fontWeight: "800",
  },
  chips: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    padding: spacing.sm,
  },
});
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/components/TierChip.tsx apps/mobile/components/TierRow.tsx
git commit -m "feat(mobile): TierChip (drag/tap pill) and TierRow (drop-zone) components"
```

---

### Task 12: Tier play screen (`app/room/[code]/tier.tsx`) + route registration

**Files:**
- Create: `apps/mobile/app/room/[code]/tier.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

The screen owns the placement state (`itemId -> zone`), the zone rects (for drag hit-testing), the tap-to-place selection, draft persistence, and the lock-in submit. Placing a chip = dropping it on a zone (drag) or selecting a chip then tapping a zone (tap).

**Interfaces:**
- Consumes: `TierChip`, `TierRow` + `ZoneRect` (Task 11); `TIERS`, `TIER_META`, `TierZone` (Task 8); `submitTierBoard`, `getRoom` (Task 7); `seededShuffle` (`lib/shuffle`); `getVoterId`, `saveTierDraft`, `getTierDraft`, `clearTierDraft` (`lib/storage`).

- [ ] **Step 1: Register the screen in `apps/mobile/app/_layout.tsx`**

Find:

```tsx
        <Stack.Screen name="room/[code]/mlt" options={{ title: "Most Likely To", headerShown: false }} />
```

Add directly after it:

```tsx
        <Stack.Screen name="room/[code]/tier" options={{ headerShown: false }} />
```

- [ ] **Step 2: Create `apps/mobile/app/room/[code]/tier.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TierChip from "../../../components/TierChip";
import TierRow, { type ZoneRect } from "../../../components/TierRow";
import { getRoom, submitTierBoard, ApiError, type RoomItem } from "../../../lib/api";
import {
  getVoterId,
  saveTierDraft,
  getTierDraft,
  clearTierDraft,
} from "../../../lib/storage";
import { seededShuffle } from "../../../lib/shuffle";
import { TIERS, TIER_META, type TierZone } from "../../../lib/tiers";
import { colors, spacing, typography, radius } from "../../../lib/theme";

export default function TierScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();

  const [topic, setTopic] = useState("");
  const [items, setItems] = useState<RoomItem[]>([]);
  const [voterId, setVoterId] = useState("");
  const [placement, setPlacement] = useState<Record<string, TierZone>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<TierZone | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zoneRects = useRef<Record<string, ZoneRect>>({});

  const navigateToWaiting = () => {
    router.replace({
      pathname: "/room/[code]/waiting",
      params: { code, name, isCreator: isCreator ?? "false" },
    });
  };

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const vId = await getVoterId();
      setVoterId(vId);
      const room = await getRoom(code, vId);
      if (room.mode !== "tier") {
        setError("This room isn't a tier list room.");
        setLoading(false);
        return;
      }
      setTopic(room.topic);
      setItems(room.items);

      // Already locked in? (myTiers holds every item) -> go wait.
      if (
        room.myTiers &&
        room.items.length > 0 &&
        Object.keys(room.myTiers).length >= room.items.length
      ) {
        navigateToWaiting();
        return;
      }

      // Restore a local draft if present; otherwise everything starts in the pool.
      const draft = await getTierDraft(code);
      const initial: Record<string, TierZone> = {};
      for (const it of room.items) {
        const d = draft?.[it.id];
        initial[it.id] =
          d === "S" || d === "A" || d === "B" || d === "C" || d === "D"
            ? d
            : "pool";
      }
      setPlacement(initial);
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

  // Deterministic per-player pool order so the initial layout isn't biased.
  const orderedItems = useMemo(
    () => (voterId ? seededShuffle(items, voterId) : items),
    [items, voterId]
  );

  const persist = (next: Record<string, TierZone>) => {
    saveTierDraft(code, next);
  };

  const moveChip = (id: string, zone: TierZone) => {
    setPlacement((prev) => {
      const next = { ...prev, [id]: zone };
      persist(next);
      return next;
    });
  };

  const handleMeasure = (zone: TierZone, rect: ZoneRect) => {
    zoneRects.current[zone] = rect;
  };

  const findZoneAt = (x: number, y: number): TierZone | null => {
    const zones: TierZone[] = [...TIERS, "pool"];
    for (const zone of zones) {
      const r = zoneRects.current[zone];
      if (!r) continue;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return zone;
      }
    }
    return null;
  };

  const handleDragMove = (_id: string, x: number, y: number) => {
    setHoverZone(findZoneAt(x, y));
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    setHoverZone(null);
    const zone = findZoneAt(x, y);
    if (zone) moveChip(id, zone);
  };

  const handleTapChip = (id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  };

  const handleZonePress = (zone: TierZone) => {
    if (!selectedId) return;
    moveChip(selectedId, zone);
    setSelectedId(null);
  };

  const chipsIn = (zone: TierZone) =>
    orderedItems.filter((it) => (placement[it.id] ?? "pool") === zone);

  const placedCount = items.filter((it) => (placement[it.id] ?? "pool") !== "pool").length;
  const allPlaced = items.length > 0 && placedCount === items.length;

  const handleLockIn = async () => {
    if (!allPlaced || submitting) return;
    setSubmitting(true);
    try {
      const placements = items.map((it) => ({
        itemId: it.id,
        tier: placement[it.id] as "S" | "A" | "B" | "C" | "D",
      }));
      await submitTierBoard(code, { voterId, voterName: name, placements });
      await clearTierDraft(code);
      navigateToWaiting();
    } catch (e: any) {
      Alert.alert("Error", e instanceof ApiError ? e.message : "Couldn't lock in your board.");
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

  const renderChip = (it: RoomItem) => (
    <TierChip
      key={it.id}
      id={it.id}
      title={it.title}
      badgeColor={colors.coral}
      selected={selectedId === it.id}
      onTap={handleTapChip}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    />
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={1}>{topic}</Text>
        <Text style={styles.progress}>{placedCount} of {items.length}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.boardScroll} showsVerticalScrollIndicator={false}>
        {TIERS.map((tier) => {
          const meta = TIER_META[tier];
          return (
            <TierRow
              key={tier}
              zone={tier}
              labelText={meta.label}
              labelColor={meta.badge}
              labelTextColor={meta.text}
              rowBg={meta.rowBg}
              highlighted={hoverZone === tier}
              selectable={!!selectedId}
              onPress={handleZonePress}
              onMeasure={handleMeasure}
            >
              {chipsIn(tier).map(renderChip)}
            </TierRow>
          );
        })}

        <Text style={styles.poolLabel}>UNPLACED</Text>
        <TierRow
          zone="pool"
          labelText="•"
          labelColor={colors.sand}
          labelTextColor={colors.slate}
          rowBg={colors.sandLight}
          highlighted={hoverZone === "pool"}
          selectable={!!selectedId}
          onPress={handleZonePress}
          onMeasure={handleMeasure}
        >
          {chipsIn("pool").map(renderChip)}
        </TierRow>
      </ScrollView>

      <View style={styles.footer}>
        {selectedId && (
          <Text style={styles.hint}>Tap a tier to place the selected item</Text>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.lockButton,
            (!allPlaced || submitting) && styles.lockButtonDisabled,
            pressed && allPlaced && !submitting && styles.lockButtonPressed,
          ]}
          onPress={handleLockIn}
          disabled={!allPlaced || submitting}
        >
          <Text style={styles.lockButtonText}>
            {submitting ? "Locking in..." : allPlaced ? "Lock in my board" : `Place all ${items.length} items`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
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
    marginBottom: spacing.sm,
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
  boardScroll: {
    paddingBottom: spacing.md,
  },
  poolLabel: {
    ...typography.tiny,
    color: colors.mist,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  footer: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.slate,
    textAlign: "center",
  },
  lockButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  lockButtonDisabled: {
    opacity: 0.5,
  },
  lockButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  lockButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
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
    borderRadius: radius.lg,
  },
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
});
```

Behavior notes captured here:
- **Two placement paths.** Drag a chip onto a row (hit-tested via `measureInWindow` rects + gesture absolute coords, works on iOS/Android/web) OR tap a chip to select then tap a row. Both call `moveChip`.
- **Resume.** On mount, a full `myTiers` means already locked in → straight to waiting. Otherwise the local draft repaints the board; the server holds no partial state.
- **Lock-in.** Enabled only when the pool is empty; submits all placements in one request, clears the draft, and navigates to waiting.

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/tier.tsx apps/mobile/app/_layout.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): tier list play screen with drag/tap placement + lock-in

Drag or tap-to-place each item into an S/A/B/C/D row. Lock in submits
the whole board at once. In-progress board persists locally for resume;
a completed board skips straight to the waiting screen.
EOF
)"
```

---

### Task 13: Dispatch to tier — lobby, waiting label, home rejoin

**Files:**
- Modify: `apps/mobile/app/room/[code]/lobby.tsx`
- Modify: `apps/mobile/app/room/[code]/waiting.tsx`
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Lobby dispatch when status becomes `voting`**

In `apps/mobile/app/room/[code]/lobby.tsx`, find:

```tsx
            pathname:
              room.mode === "rank" ? "/room/[code]/rank" :
              room.mode === "bracket" ? "/room/[code]/bracket" :
              room.mode === "mlt" ? "/room/[code]/mlt" :
              "/room/[code]/swipe",
```

Replace with:

```tsx
            pathname:
              room.mode === "rank" ? "/room/[code]/rank" :
              room.mode === "bracket" ? "/room/[code]/bracket" :
              room.mode === "mlt" ? "/room/[code]/mlt" :
              room.mode === "tier" ? "/room/[code]/tier" :
              "/room/[code]/swipe",
```

- [ ] **Step 2: Waiting screen mode union + "Sorting..." label**

In `apps/mobile/app/room/[code]/waiting.tsx`, find:

```tsx
  const [mode, setMode] = useState<"vote" | "rank" | "bracket" | "mlt">("vote");
```

Replace with:

```tsx
  const [mode, setMode] = useState<"vote" | "rank" | "bracket" | "mlt" | "tier">("vote");
```

Find:

```tsx
                    : mode === "mlt"
                    ? "Voting on prompts..."
                    : "Swiping..."}
```

Replace with:

```tsx
                    : mode === "mlt"
                    ? "Voting on prompts..."
                    : mode === "tier"
                    ? "Sorting..."
                    : "Swiping..."}
```

- [ ] **Step 3: Home rejoin dispatch**

In `apps/mobile/app/index.tsx`, find:

```tsx
          pathname:
            data.mode === "rank" ? "/room/[code]/rank" :
            data.mode === "bracket" ? "/room/[code]/bracket" :
            data.mode === "mlt" ? "/room/[code]/mlt" :
            "/room/[code]/swipe",
```

Replace with:

```tsx
          pathname:
            data.mode === "rank" ? "/room/[code]/rank" :
            data.mode === "bracket" ? "/room/[code]/bracket" :
            data.mode === "mlt" ? "/room/[code]/mlt" :
            data.mode === "tier" ? "/room/[code]/tier" :
            "/room/[code]/swipe",
```

- [ ] **Step 4: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/lobby.tsx apps/mobile/app/room/[code]/waiting.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): dispatch tier rooms from lobby/rejoin; 'Sorting...' waiting label"
```

---

### Task 14: Tier reveal — `TierBoard.tsx` + results dispatch

**Files:**
- Create: `apps/mobile/components/TierBoard.tsx`
- Modify: `apps/mobile/app/room/[code]/results.tsx`

**Interfaces:**
- Consumes: `TierResultsResponse`, `TierConsensusRow`, `Tier` (Task 7); `TIERS`, `TIER_META` (Task 8).
- Produces: `TierBoard` (default export) with props `{ rows: { tier: Tier; titles: string[] }[] }`.

- [ ] **Step 1: Create the static `TierBoard.tsx`**

```tsx
import { View, Text, StyleSheet } from "react-native";
import { colors, radius, spacing, typography } from "../lib/theme";
import { TIERS, TIER_META } from "../lib/tiers";
import type { Tier } from "../lib/api";

type Props = {
  rows: { tier: Tier; titles: string[] }[];
};

export default function TierBoard({ rows }: Props) {
  const titlesByTier = new Map(rows.map((r) => [r.tier, r.titles]));

  return (
    <View style={styles.board}>
      {TIERS.map((tier) => {
        const meta = TIER_META[tier];
        const titles = titlesByTier.get(tier) ?? [];
        return (
          <View key={tier} style={[styles.row, { backgroundColor: meta.rowBg }]}>
            <View style={[styles.label, { backgroundColor: meta.badge }]}>
              <Text style={[styles.labelText, { color: meta.text }]}>{meta.label}</Text>
            </View>
            <View style={styles.chips}>
              {titles.length === 0 ? (
                <Text style={styles.empty}>—</Text>
              ) : (
                titles.map((title, i) => (
                  <View key={`${title}-${i}`} style={styles.chip}>
                    <Text style={styles.chipText} numberOfLines={1}>{title}</Text>
                  </View>
                ))
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: radius.md,
    minHeight: 52,
  },
  label: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
  },
  labelText: {
    fontSize: 20,
    fontWeight: "800",
  },
  chips: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    padding: spacing.sm,
  },
  chip: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.sand,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    maxWidth: 160,
  },
  chipText: {
    ...typography.caption,
    color: colors.charcoal,
    fontWeight: "700",
  },
  empty: {
    ...typography.body,
    color: colors.mist,
  },
});
```

- [ ] **Step 2: Wire the tier branch into `results.tsx`**

In `apps/mobile/app/room/[code]/results.tsx`, add the import near the other component imports:

Find:

```tsx
import MltRevealCard from "../../../components/MltRevealCard";
```

Add after it:

```tsx
import TierBoard from "../../../components/TierBoard";
import { TIERS } from "../../../lib/tiers";
import type { Tier } from "../../../lib/api";
```

Find the results-type extractions:

```tsx
type RevealedMltResults = Extract<ResultsResponse, { revealed: true; mode: "mlt" }>;
```

Add after it:

```tsx
type RevealedTierResults = Extract<ResultsResponse, { revealed: true; mode: "tier" }>;
```

Find the state declarations:

```tsx
  const [mltData, setMltData] = useState<RevealedMltResults | null>(null);
```

Add after it:

```tsx
  const [tierData, setTierData] = useState<RevealedTierResults | null>(null);
```

Find the discriminator chain in `loadResults`:

```tsx
      } else if ("mode" in res && res.mode === "mlt") {
        setMltData(res as RevealedMltResults);
      } else {
        setVoteData(res as RevealedVoteResults);
      }
```

Replace with:

```tsx
      } else if ("mode" in res && res.mode === "mlt") {
        setMltData(res as RevealedMltResults);
      } else if ("mode" in res && res.mode === "tier") {
        setTierData(res as RevealedTierResults);
      } else {
        setVoteData(res as RevealedVoteResults);
      }
```

Find the empty-state guard:

```tsx
  if (error || (!voteData && !rankData && !bracketData && !mltData)) {
```

Replace with:

```tsx
  if (error || (!voteData && !rankData && !bracketData && !mltData && !tierData)) {
```

Find the `if (bracketData) { ... }` block's closing `}` immediately followed by:

```tsx
  // Vote-mode results
  return renderVoteResults(voteData!, insets, router);
```

Replace that `// Vote-mode results` line and the return with a tier branch inserted before it:

```tsx
  if (tierData) {
    return (
      <TierResultsView
        data={tierData}
        myVoterId={myVoterId}
        insets={insets}
        onHome={() => router.replace("/")}
      />
    );
  }

  // Vote-mode results
  return renderVoteResults(voteData!, insets, router);
```

- [ ] **Step 3: Add the `TierResultsView` component and its styles at the bottom of `results.tsx`**

At the very end of the file (after `mltResultsStyles`), append:

```tsx
function TierResultsView({
  data,
  myVoterId,
  insets,
  onHome,
}: {
  data: RevealedTierResults;
  myVoterId: string;
  insets: ReturnType<typeof useSafeAreaInsets>;
  onHome: () => void;
}) {
  // Tab 0 = Consensus; tabs 1..N = each player's board.
  const [tab, setTab] = useState(0);

  // `getResults` doesn't send a voterId, so pin "You" first client-side.
  const orderedPlayers = [...data.players].sort((a, b) => {
    if (a.voterId === myVoterId) return -1;
    if (b.voterId === myVoterId) return 1;
    return 0;
  });

  const consensusRows = TIERS.map((tier) => ({
    tier,
    titles:
      data.consensus.find((r) => r.tier === tier)?.items.map((i) => i.title) ?? [],
  }));

  const playerRows = (placements: { title: string; tier: Tier }[]) =>
    TIERS.map((tier) => ({
      tier,
      titles: placements.filter((p) => p.tier === tier).map((p) => p.title),
    }));

  const tabs = [
    { key: "consensus", label: "Consensus" },
    ...orderedPlayers.map((p) => ({
      key: p.voterId,
      label: p.voterId === myVoterId ? "You" : p.name,
    })),
  ];

  const activePlayer = tab === 0 ? null : orderedPlayers[tab - 1];
  const rows = tab === 0 ? consensusRows : playerRows(activePlayer!.placements);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.cream }}
      contentContainerStyle={{ paddingTop: insets.top + 16, padding: spacing.xl, paddingBottom: spacing.xxl }}
    >
      <Text style={tierResultsStyles.topic}>{data.topic}</Text>
      <Text style={tierResultsStyles.meta}>
        {tab === 0 ? "Averaged from every board" : `${tabs[tab].label}'s board`}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={tierResultsStyles.tabs}
      >
        {tabs.map((t, i) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(i)}
            style={[tierResultsStyles.tab, tab === i && tierResultsStyles.tabActive]}
          >
            <Text style={[tierResultsStyles.tabText, tab === i && tierResultsStyles.tabTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ marginTop: spacing.lg }}>
        <TierBoard rows={rows} />
      </View>

      <Pressable
        style={({ pressed }) => [tierResultsStyles.homeButton, pressed && { opacity: 0.85 }]}
        onPress={onHome}
      >
        <Text style={tierResultsStyles.homeButtonText}>Back to Home</Text>
      </Pressable>
    </ScrollView>
  );
}

const tierResultsStyles = StyleSheet.create({
  topic: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
  },
  meta: {
    ...typography.caption,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  tabs: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.warmWhite,
    borderWidth: 1,
    borderColor: colors.sand,
  },
  tabActive: {
    backgroundColor: colors.coral,
    borderColor: colors.coral,
  },
  tabText: {
    ...typography.caption,
    color: colors.slate,
    fontWeight: "700",
  },
  tabTextActive: {
    color: colors.warmWhite,
  },
  homeButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.xl,
    ...shadows.button,
  },
  homeButtonText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
});
```

- [ ] **Step 4: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/components/TierBoard.tsx apps/mobile/app/room/[code]/results.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): tier reveal — Consensus board + switchable per-player boards

Adds a static TierBoard and a TierResultsView with a tab switcher
between the averaged Consensus board and each player's board (You first).
EOF
)"
```

---

### Task 15: Manual cross-platform smoke test

**Files:** none (verification only).

- [ ] **Step 1: Start API + mobile**

```bash
cd apps/api && npx wrangler dev
```

In another terminal:

```bash
cd apps/mobile && npx expo start
```

Pick a target: iOS simulator (`i`), Android emulator (`a`), or web (`w`).

- [ ] **Step 2: Creator flow**

Home → Create a Room → tap **Tier List** → enter a topic + your name → Create Room. On the share screen: the count badge reads `x/12`; the suggestions toggle is hidden; Start is disabled until 3 items; adding a 13th is blocked; the button reads **Start Tier List**. Add ~6 items. Have a second device/tab join (below) so participants ≥ 2, then tap Start.

Expected: lands on the tier play screen — five S/A/B/C/D rows and an UNPLACED pool with all items.

- [ ] **Step 3: Placement (drag + tap)**

Drag a chip into a row — the row highlights while hovering and the chip lands there. Drag a chip from one row to another. Then tap a chip (it highlights) and tap a different row — it moves. Place all items; the pool empties; the button switches to **Lock in my board**. Tap it.

Expected: navigates to the waiting screen; the voter badge shows "Sorting..." for anyone still placing.

- [ ] **Step 4: Second participant + reveal**

On a second simulator/emulator/browser tab (web sessionStorage gives each tab its own voter ID), Join → code → name → lobby. When the host starts, the lobby auto-routes to the tier screen. Place all items and lock in.

Expected: when the second player locks in, both auto-advance to results. The reveal shows the **Consensus** board first, with a tab row `[Consensus] [You] [<names>]`. Tapping a player tab shows that player's board.

- [ ] **Step 5: Resume check**

Start a fresh tier game, place a few items, then fully close/reload the app. Reopen via the rejoin banner (or re-navigate).

Expected: the in-progress board is restored from the local draft (placed chips are still in their rows). Locking in and reopening lands you on the waiting screen (already-locked-in short-circuit).

- [ ] **Step 6: Regression spot-check**

Create a Swipe Vote room and a Blind Rank room; confirm both still work end-to-end (unchanged).

- [ ] **Step 7: Cross-platform**

If the primary check was iOS, re-run drag + tap placement on Android and web. Web drag uses pointer events — confirm hit-testing feels accurate; the tap-to-place path is the reliable fallback if any drag feels rough.

- [ ] **Step 8: No code change**

Verification only. File follow-ups for any regressions found; otherwise proceed.

---

### Task 16: Wrap-up

**Files:** none — verification + housekeeping.

- [ ] **Step 1: Confirm migration order is clean**

```bash
ls apps/api/migrations/
```

Expected: `0001_init.sql` … `0007_mlt_mode.sql`, `0008_tier_list_mode.sql`.

- [ ] **Step 2: Document the production deploy (do NOT run without user approval)**

The user deploys when satisfied with local:

```bash
cd apps/api
npx wrangler d1 migrations apply tot-db --remote
npx wrangler deploy
```

Also remember `apps/mobile/lib/api.ts` `API_BASE` points at `http://localhost:8787/api` for local dev and must be reverted to the production Workers URL before shipping the app (per the comment at the top of that file). Do not change it as part of this plan.

- [ ] **Step 3: Optional CLAUDE.md note**

If the user wants it, add "Tier List" to any modes list in CLAUDE.md and point at the spec. Skip otherwise.

---

## Self-review checklist

- Spec **user flow** (mode picker → share add/start → play → waiting → reveal) — Tasks 9, 10, 12, 13, 14.
- Spec **play screen** (drag board + tap fallback + lock-in + per-player pool shuffle + local draft) — Tasks 11, 12.
- Spec **averaging** (S=5..D=1, `Math.round` half-up toward S, within-tier by average then sort_order) — Task 5 (Global Constraints).
- Spec **reveal** (Consensus + switchable per-player boards, You first) — Task 14.
- Spec **data model** (`tier_placements`, schema.sql mirror) — Task 1.
- Spec **API existing-endpoint additions** (create/items/start/GET/settings) — Task 2; votes reject — Task 3.
- Spec **API new endpoint** (`POST /tiers`) + auto-reveal — Task 4.
- Spec **tier /status + /results** — Task 5.
- Spec **mode-mismatch errors** — Tasks 2 (settings), 3 (votes); rankings/bracket/mlt already reject foreign modes.
- Spec **behavior notes** (resume post/pre-lock-in, late joiners, suggestions forced off) — Tasks 2, 12.
- Spec **validation summary** — Tasks 2, 4.
- Spec **testing** — Tasks 6, 15.
- Spec **file layout** matches the File map above.

Type/name consistency: `submitTierBoard`, `TierResultsResponse`, `TierConsensusRow`, `TierPlayerBoard`, `Tier`, `TierZone`, `TIERS`, `TIER_META`, `getTierPlacementsByRoom`, `getTierPlacementsByVoter`, `TierChip`, `TierRow`, `ZoneRect`, `TierBoard`, `TierResultsView`, `maybeRevealTier`, `getTierResults`, `saveTierDraft`/`getTierDraft`/`clearTierDraft`, `myTiers`, `tier_placements` — used identically across producer and consumer tasks. No placeholders or `TODO`s.
```