# Bracket Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third game mode (Bracket) alongside Swipe Vote and Blind Rank. Host adds 4–16 items; server seeds a single-elimination tournament with random byes; participants vote on sequential head-to-head matchups; between rounds a bracket-reveal screen shows the updated tree; final reveal shows the winner with per-matchup vote breakdowns.

**Architecture:** Add `'bracket'` to the existing `mode` enum on rooms. Add two new tables: `matchups` (one row per pairing, lazily created per round) and `matchup_votes` (one row per voter per matchup). Mode-specific behavior lives in `routes/bracket.ts` (new) and `app/room/[code]/bracket.tsx` + `round-reveal.tsx` (new); existing swipe and rank code is untouched. Round advancement is server-driven on the last vote; tied matchups resolved by a server coin flip.

**Tech Stack:** Hono on Cloudflare Workers + D1 SQLite (API). Expo Router + React Native (mobile, cross-platform iOS/Android/web). No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-20-bracket-game-mode-design.md`

**Testing note:** Project has no automated test infrastructure (per CLAUDE.md: "add after MVP"). Each task uses manual verification — curl + `wrangler dev` for the API; `npx expo start` for the mobile app. Don't introduce a test framework unless the user asks.

---

## File map

**API — modify:**
- `apps/api/src/db/queries.ts` — extend `Room.mode` union, add `Matchup` + `MatchupVote` types, add helpers
- `apps/api/src/db/schema.sql` — mirror the new tables for fresh DBs
- `apps/api/src/routes/rooms.ts` — accept `'bracket'` mode; mode-aware item cap (max 16); `/start` validates and seeds Round 1 matchups
- `apps/api/src/routes/votes.ts` — reject bracket rooms
- `apps/api/src/routes/rankings.ts` — reject bracket rooms (both endpoints)
- `apps/api/src/routes/results.ts` — `/status` returns `currentRound`; `/results` dispatches to a bracket-shape response
- `apps/api/src/index.ts` — mount the new bracket router

**API — create:**
- `apps/api/migrations/0006_bracket_mode.sql`
- `apps/api/src/routes/bracket.ts` — `GET /bracket`, `POST /matchup-votes`, round advancement helper

**Mobile — modify:**
- `apps/mobile/lib/api.ts` — add `'bracket'` to mode unions; add bracket client functions + response types
- `apps/mobile/app/_layout.tsx` — register `room/[code]/bracket` and `room/[code]/round-reveal`
- `apps/mobile/app/create/mode.tsx` — add the third "Bracket" card
- `apps/mobile/app/create/index.tsx` — accept `mode=bracket`; hide suggestions toggle in bracket mode
- `apps/mobile/app/create/share.tsx` — for bracket: cap items at 16, require ≥4 to start, route to `/room/[code]/bracket` on Start
- `apps/mobile/app/room/[code]/lobby.tsx` — dispatch to bracket screen when status becomes `voting`
- `apps/mobile/app/room/[code]/waiting.tsx` — mode-aware in-progress label; detect round-advance vs. reveal
- `apps/mobile/app/room/[code]/results.tsx` — dispatch on `mode === 'bracket'` to render the BracketTree final reveal
- `apps/mobile/app/index.tsx` — home-rejoin honors bracket mode (analogous to existing rank handling)

**Mobile — create:**
- `apps/mobile/app/room/[code]/bracket.tsx` — sequential matchup voting screen
- `apps/mobile/app/room/[code]/round-reveal.tsx` — between-round bracket reveal screen
- `apps/mobile/components/MatchupCard.tsx` — large tappable card for one side of a matchup
- `apps/mobile/components/BracketTree.tsx` — vertical bracket renderer used in round-reveal and results

---

## Phase A — API

### Task 1: Migration, types, query helpers

**Files:**
- Create: `apps/api/migrations/0006_bracket_mode.sql`
- Modify: `apps/api/src/db/schema.sql`
- Modify: `apps/api/src/db/queries.ts`

- [ ] **Step 1: Write the migration**

Create `apps/api/migrations/0006_bracket_mode.sql`:

```sql
-- The `mode` column already exists (added in 0005). Allowed values become
-- 'vote' | 'rank' | 'bracket' — no schema constraint, the app enforces it.

CREATE TABLE matchups (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  item_a_id TEXT REFERENCES items(id),
  item_b_id TEXT REFERENCES items(id),
  winner_item_id TEXT REFERENCES items(id),
  is_bye INTEGER NOT NULL DEFAULT 0,
  decided_by_tiebreak INTEGER NOT NULL DEFAULT 0,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, round, slot)
);

CREATE TABLE matchup_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  matchup_id TEXT NOT NULL REFERENCES matchups(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  picked_item_id TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(matchup_id, voter_id)
);

CREATE INDEX idx_matchups_room ON matchups(room_id);
CREATE INDEX idx_matchups_room_round ON matchups(room_id, round);
CREATE INDEX idx_matchup_votes_room ON matchup_votes(room_id);
CREATE INDEX idx_matchup_votes_matchup ON matchup_votes(matchup_id);
CREATE INDEX idx_matchup_votes_room_voter ON matchup_votes(room_id, voter_id);
```

- [ ] **Step 2: Mirror the changes in `apps/api/src/db/schema.sql`**

Add the two new `CREATE TABLE` blocks and indexes so a fresh DB matches a migrated one.

The end-state of `apps/api/src/db/schema.sql` (relevant additions shown in context — append after the existing `rankings` block and inside the `-- Indexes` block):

```sql
-- Matchups (bracket mode)
CREATE TABLE matchups (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  item_a_id TEXT REFERENCES items(id),
  item_b_id TEXT REFERENCES items(id),
  winner_item_id TEXT REFERENCES items(id),
  is_bye INTEGER NOT NULL DEFAULT 0,
  decided_by_tiebreak INTEGER NOT NULL DEFAULT 0,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, round, slot)
);

-- Matchup votes (bracket mode)
CREATE TABLE matchup_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  matchup_id TEXT NOT NULL REFERENCES matchups(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  picked_item_id TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(matchup_id, voter_id)
);
```

Add these to the `-- Indexes` section at the bottom:

```sql
CREATE INDEX idx_matchups_room ON matchups(room_id);
CREATE INDEX idx_matchups_room_round ON matchups(room_id, round);
CREATE INDEX idx_matchup_votes_room ON matchup_votes(room_id);
CREATE INDEX idx_matchup_votes_matchup ON matchup_votes(matchup_id);
CREATE INDEX idx_matchup_votes_room_voter ON matchup_votes(room_id, voter_id);
```

- [ ] **Step 3: Apply the migration locally**

Run from the repo root:

```bash
cd apps/api && npx wrangler d1 migrations apply tot-db --local
```

Expected output: `Migrations to be applied: 0006_bracket_mode.sql` followed by success.

- [ ] **Step 4: Extend types in `apps/api/src/db/queries.ts`**

Open `apps/api/src/db/queries.ts` and update the `Room` type's `mode` union to include `'bracket'`. Find:

```ts
export type Room = {
  // ...
  mode: "vote" | "rank";
  // ...
};
```

Replace `mode: "vote" | "rank";` with:

```ts
  mode: "vote" | "rank" | "bracket";
```

Then add the new types at the bottom of the file (alongside the existing `Ranking` type):

```ts
export type Matchup = {
  id: string;
  room_id: string;
  round: number;
  slot: number;
  item_a_id: string | null;
  item_b_id: string | null;
  winner_item_id: string | null;
  is_bye: number;
  decided_by_tiebreak: number;
  decided_at: string | null;
  created_at: string;
};

export type MatchupVote = {
  id: string;
  room_id: string;
  matchup_id: string;
  voter_id: string;
  voter_name: string;
  picked_item_id: string;
  created_at: string;
};
```

- [ ] **Step 5: Add matchup query helpers to `apps/api/src/db/queries.ts`**

Append these helpers at the bottom of the file:

```ts
export async function getMatchupsByRoom(
  db: D1Database,
  roomId: string
): Promise<Matchup[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchups WHERE room_id = ? ORDER BY round ASC, slot ASC")
    .bind(roomId)
    .all<Matchup>();
  return results;
}

export async function getMatchupsByRoomAndRound(
  db: D1Database,
  roomId: string,
  round: number
): Promise<Matchup[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchups WHERE room_id = ? AND round = ? ORDER BY slot ASC")
    .bind(roomId, round)
    .all<Matchup>();
  return results;
}

export async function getMatchupVotesByRoom(
  db: D1Database,
  roomId: string
): Promise<MatchupVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchup_votes WHERE room_id = ?")
    .bind(roomId)
    .all<MatchupVote>();
  return results;
}

export async function getMatchupVotesByVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<MatchupVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchup_votes WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<MatchupVote>();
  return results;
}

// Returns the latest round number that has at least one matchup row.
// For a freshly-started bracket room this is 1. After R1 closes and R2 is
// created, this becomes 2. Returns 0 if no matchups exist.
export async function getCurrentRound(db: D1Database, roomId: string): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(round) as max_round FROM matchups WHERE room_id = ?")
    .bind(roomId)
    .first<{ max_round: number | null }>();
  return row?.max_round ?? 0;
}
```

- [ ] **Step 6: Compile-check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors. (If any callers of `Room.mode` use a switch/exhaustive check, fix in the appropriate task below — most code does `room.mode === "rank"` comparisons which already handle the broader union.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations/0006_bracket_mode.sql apps/api/src/db/schema.sql apps/api/src/db/queries.ts
git commit -m "$(cat <<'EOF'
feat(api): add migration, types, queries for bracket mode

- 0006 migration: matchups table (round/slot pairings with byes and
  tiebreak flag) and matchup_votes table with UNIQUE(matchup,voter).
- Mirror in schema.sql so fresh DBs match migrated ones.
- Extend Room.mode union with 'bracket'; add Matchup, MatchupVote
  types plus helpers (by-room, by-round, by-voter, current round).
EOF
)"
```

---

### Task 2: Update `routes/rooms.ts` — accept bracket mode, 4–16 cap, seed Round 1 on /start

**Files:**
- Modify: `apps/api/src/routes/rooms.ts`

- [ ] **Step 1: Update `POST /api/rooms` to accept and persist `'bracket'`**

Find the mode validation in the create handler:

```ts
const mode = body.mode ?? "vote";
if (mode !== "vote" && mode !== "rank") {
  return validationError("mode must be 'vote' or 'rank'");
}
```

Replace with:

```ts
const mode = body.mode ?? "vote";
if (mode !== "vote" && mode !== "rank" && mode !== "bracket") {
  return validationError("mode must be 'vote', 'rank', or 'bracket'");
}
```

Find the `allowSuggestions` line that forces it off for rank rooms:

```ts
const allowSuggestions = mode === "rank" ? 0 : (body.allowSuggestions ? 1 : 0);
```

Replace with (bracket rooms also force suggestions off — the item pool is fixed by design):

```ts
const allowSuggestions = (mode === "rank" || mode === "bracket") ? 0 : (body.allowSuggestions ? 1 : 0);
```

- [ ] **Step 2: Update `POST /api/rooms/:code/items` — cap bracket rooms at 16 and reject participant adds**

Find the existing block:

```ts
const isCreator = creatorVoterId && creatorVoterId === room.creator_voter_id;

if (!isCreator && room.mode === "rank") {
  return invalidStatus("Participants cannot add items in a blind rank room");
}

const maxItems = room.mode === "rank" ? 5 : 15;
```

Replace with:

```ts
const isCreator = creatorVoterId && creatorVoterId === room.creator_voter_id;

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

(Bracket allows up to 16 items but only requires ≥4 to start — the floor is checked on `/start`, not on add.)

- [ ] **Step 3: Update `POST /api/rooms/:code/start` — validate 4–16 and seed Round 1 matchups for bracket**

Find the existing start handler's validation block:

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
```

Replace with:

```ts
const itemCount = await getItemCount(db, room.id);
if (room.mode === "rank") {
  if (itemCount !== 5) {
    return validationError("Blind rank rooms must have exactly 5 items to start");
  }
} else if (room.mode === "bracket") {
  if (itemCount < 4 || itemCount > 16) {
    return validationError("Bracket rooms need between 4 and 16 items to start");
  }
} else {
  if (itemCount < 2) {
    return validationError("Room must have at least 2 items to start voting");
  }
}
```

Now find the existing rank-mode seeding block (the `if (room.mode === "rank")` that runs Fisher-Yates and writes presentation_order). Immediately AFTER that block (and before the final `else { /* vote mode just flips status */ }`), add a parallel branch for bracket:

The end-state of the relevant chunk:

```ts
if (room.mode === "rank") {
  // ...existing rank-seeding code unchanged...
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
  const statements: D1PreparedStatement[] = [];

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
```

(The existing rank-mode branch already wraps its inserts in `db.batch`. The bracket branch follows the same pattern for atomicity.)

The `return Response.json({ success: true, status: "voting", itemCount, mode: room.mode });` at the end stays unchanged.

Note: `D1PreparedStatement` is the Cloudflare Workers D1 type for a prepared statement, available globally via `@cloudflare/workers-types` (already in this project). If TypeScript complains, type `statements` as `any[]` — the existing rank-mode code in this file does not annotate its `statements` variable.

- [ ] **Step 4: Update `GET /api/rooms/:code` — items hidden for bracket post-start, mode already in response**

The response already includes `mode` from the rank changes. For bracket rooms, the items list is fine to include even during voting (we don't need to hide them — items appear on the matchup screen anyway, two at a time). But for consistency with the spec's "hide items array post-start" principle, treat bracket like rank.

Find the items-visibility branch:

```ts
const showItemsForVoteMode =
  room.mode === "vote" &&
  (room.status !== "open" || isCreator || room.allow_suggestions);
const showItemsForRankMode = room.mode === "rank" && room.status === "open" && isCreator;
if (showItemsForVoteMode || showItemsForRankMode) {
  // ...build items array...
}
```

Replace with:

```ts
const showItemsForVoteMode =
  room.mode === "vote" &&
  (room.status !== "open" || isCreator || room.allow_suggestions);
const showItemsForRankMode = room.mode === "rank" && room.status === "open" && isCreator;
const showItemsForBracketMode = room.mode === "bracket" && room.status === "open" && isCreator;
if (showItemsForVoteMode || showItemsForRankMode || showItemsForBracketMode) {
  // ...build items array (unchanged)...
}
```

(The `myVotes` and `myRankings` blocks remain unchanged. There is no `myBracketVotes` here — the bracket play screen calls `/bracket` for its state.)

- [ ] **Step 5: Update `PATCH /api/rooms/:code/settings` — reject `allowSuggestions: true` on bracket rooms**

Find the existing rank check:

```ts
if (room.mode === "rank" && allowSuggestions === true) {
  return invalidStatus("Item suggestions are not available in blind rank rooms");
}
```

Replace with:

```ts
if (room.mode === "rank" && allowSuggestions === true) {
  return invalidStatus("Item suggestions are not available in blind rank rooms");
}
if (room.mode === "bracket" && allowSuggestions === true) {
  return invalidStatus("Item suggestions are not available in bracket rooms");
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
feat(api): mode-aware rooms routes for bracket

- POST /rooms accepts 'bracket' mode; bracket forces allow_suggestions off.
- POST /:code/items caps bracket rooms at 16 and rejects participant adds.
- POST /:code/start requires 4-16 items for bracket and atomically
  seeds Round 1 matchups (real pairings + bye matchups for non-power-of-2
  counts) using db.batch.
- GET /:code hides items for bracket rooms post-start (clients use
  /bracket instead).
- PATCH /:code/settings rejects enabling suggestions on bracket rooms.
EOF
)"
```

---

### Task 3: Reject vote and ranking submissions on bracket rooms

**Files:**
- Modify: `apps/api/src/routes/votes.ts`
- Modify: `apps/api/src/routes/rankings.ts`

- [ ] **Step 1: Add bracket check in `votes.ts`**

Find in `apps/api/src/routes/votes.ts`:

```ts
if (room.mode === "rank") {
  return validationError("This is a blind rank room — use /rankings instead of /votes");
}
```

Replace with:

```ts
if (room.mode === "rank") {
  return validationError("This is a blind rank room — use /rankings instead of /votes");
}
if (room.mode === "bracket") {
  return validationError("This is a bracket room — use /matchup-votes instead of /votes");
}
```

- [ ] **Step 2: Add bracket check in `rankings.ts` for both endpoints**

In `apps/api/src/routes/rankings.ts`, find in the GET `/next-item` handler:

```ts
if (room.mode !== "rank") return invalidStatus("This room is not a blind rank room");
```

The condition already rejects non-rank rooms (including bracket). The error message says "is not a blind rank room" which is accurate. No change needed here — the existing check covers it.

Find in the POST `/rankings` handler:

```ts
if (room.mode !== "rank") {
  return validationError("This room is not a blind rank room");
}
```

Same — already rejects bracket. No change needed.

(The rank router is already exclusive — anything not `mode === 'rank'` is rejected. Leave it as-is; just confirm by reading both handlers.)

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/votes.ts
git commit -m "feat(api): reject vote submissions on bracket-mode rooms"
```

(Rankings router needs no change; the existing `room.mode !== "rank"` checks already reject bracket-mode requests.)

---

### Task 4: Create `routes/bracket.ts` — GET /bracket, POST /matchup-votes, round advancement

**Files:**
- Create: `apps/api/src/routes/bracket.ts`
- Modify: `apps/api/src/index.ts` (mount router)

- [ ] **Step 1: Write the new router file**

Create `apps/api/src/routes/bracket.ts` with the full contents:

```ts
import { createRouter } from "../types";
import {
  getRoomByCode,
  getItemsByRoomId,
  getMatchupsByRoom,
  getMatchupsByRoomAndRound,
  getMatchupVotesByRoom,
  getMatchupVotesByVoter,
  getCurrentRound,
  type Matchup,
} from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";

export const bracket = createRouter();

// GET /api/rooms/:code/bracket?voterId=X
// Returns past + current rounds. Future rounds aren't materialized yet
// (they're created server-side when the previous round closes), so a curious
// client cannot peek at them.
bracket.get("/:code/bracket", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "bracket") {
    return invalidStatus("This room is not a bracket room");
  }
  if (room.status === "open") {
    return invalidStatus("Bracket hasn't started yet");
  }

  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const N = items.length;
  let P = 1;
  while (P < N) P *= 2;
  const totalRounds = Math.log2(P); // integer when N >= 1

  const allMatchups = await getMatchupsByRoom(db, room.id);
  const currentRound = room.status === "revealed" ? null : await getCurrentRound(db, room.id);

  // Group matchups by round.
  const byRound = new Map<number, Matchup[]>();
  for (const m of allMatchups) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }
  for (const list of byRound.values()) list.sort((a, b) => a.slot - b.slot);

  // Vote breakdowns ONLY for past (decided) rounds, never for the current
  // round (anti-strategy). When the room is revealed, currentRound is null
  // so all rounds count as past.
  const allVotes = await getMatchupVotesByRoom(db, room.id);
  const votesByMatchup = new Map<string, { voterId: string; voterName: string; pickedItemId: string }[]>();
  for (const v of allVotes) {
    if (!votesByMatchup.has(v.matchup_id)) votesByMatchup.set(v.matchup_id, []);
    votesByMatchup.get(v.matchup_id)!.push({
      voterId: v.voter_id,
      voterName: v.voter_name,
      pickedItemId: v.picked_item_id,
    });
  }

  const rounds = [...byRound.keys()].sort((a, b) => a - b).map((round) => {
    const matchups = byRound.get(round)!.map((m) => {
      const isPastRound = currentRound === null || round < currentRound;
      const includeBreakdown = isPastRound && m.winner_item_id !== null;
      return {
        id: m.id,
        slot: m.slot,
        itemA: m.item_a_id
          ? { id: m.item_a_id, title: titleById.get(m.item_a_id) ?? "" }
          : null,
        itemB: m.item_b_id
          ? { id: m.item_b_id, title: titleById.get(m.item_b_id) ?? "" }
          : null,
        winner: m.winner_item_id
          ? { id: m.winner_item_id, title: titleById.get(m.winner_item_id) ?? "" }
          : null,
        isBye: !!m.is_bye,
        decidedByTiebreak: !!m.decided_by_tiebreak,
        voteBreakdown: includeBreakdown ? (votesByMatchup.get(m.id) ?? []) : undefined,
      };
    });
    return { round, matchups };
  });

  // My votes across all rounds (used by client to repaint and to skip
  // already-voted matchups when resuming mid-round).
  const myVotes: Record<string, string> = {};
  if (voterId) {
    const mine = await getMatchupVotesByVoter(db, room.id, voterId);
    for (const v of mine) myVotes[v.matchup_id] = v.picked_item_id;
  }

  return Response.json({
    currentRound,
    totalRounds,
    rounds,
    myVotes,
  });
});

// POST /api/rooms/:code/matchup-votes
bracket.post("/:code/matchup-votes", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { matchupId, voterId, voterName, pickedItemId } = body;

  if (!matchupId || typeof matchupId !== "string") {
    return validationError("matchupId is required");
  }
  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (!pickedItemId || typeof pickedItemId !== "string") {
    return validationError("pickedItemId is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "bracket") {
    return validationError("This room is not a bracket room");
  }
  if (room.status !== "voting") {
    return invalidStatus("Matchup votes can only be submitted while voting is open");
  }

  // Verify participant.
  const participant = await db
    .prepare("SELECT id FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first();
  if (!participant) return validationError("You must join the room before voting");

  // Verify matchup belongs to this room, is in the current round, isn't a bye,
  // and pickedItemId is one of the two competitors.
  const matchup = await db
    .prepare("SELECT * FROM matchups WHERE id = ? AND room_id = ?")
    .bind(matchupId, room.id)
    .first<Matchup>();
  if (!matchup) return validationError("Matchup not found in this room");
  if (matchup.is_bye) return validationError("Cannot vote on a bye matchup");

  const currentRound = await getCurrentRound(db, room.id);
  if (matchup.round !== currentRound) {
    return invalidStatus("That matchup is not in the current round");
  }
  if (pickedItemId !== matchup.item_a_id && pickedItemId !== matchup.item_b_id) {
    return validationError("pickedItemId must be one of the matchup's two items");
  }

  // Insert vote. UNIQUE(matchup_id, voter_id) catches double-votes.
  try {
    await db
      .prepare(
        "INSERT INTO matchup_votes (id, room_id, matchup_id, voter_id, voter_name, picked_item_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), room.id, matchupId, voterId, voterName.trim(), pickedItemId)
      .run();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE")) {
      return validationError("You have already voted on this matchup");
    }
    throw e;
  }

  // Try to advance the round (idempotent — safe to call concurrently).
  await maybeAdvanceRound(db, room.id, currentRound);

  // Compute progress for this voter in the current round.
  const currentRoundMatchups = await getMatchupsByRoomAndRound(db, room.id, currentRound);
  const realMatchupIds = new Set(
    currentRoundMatchups.filter((m) => !m.is_bye).map((m) => m.id)
  );
  const myVotes = await getMatchupVotesByVoter(db, room.id, voterId);
  const votedThisRound = myVotes.filter((v) => realMatchupIds.has(v.matchup_id)).length;

  return Response.json(
    {
      success: true,
      progress: { votedThisRound, totalThisRound: realMatchupIds.size },
    },
    { status: 201 }
  );
});

// If all participants have voted on every real matchup in the round, decide
// each matchup (majority, coin-flip on ties), then either create next-round
// matchups or transition to 'revealed'.
async function maybeAdvanceRound(db: D1Database, roomId: string, round: number) {
  const matchups = await getMatchupsByRoomAndRound(db, roomId, round);
  const realMatchups = matchups.filter((m) => !m.is_bye);
  if (realMatchups.length === 0) {
    // All byes (shouldn't happen — Round 1 always has ≥1 real matchup for
    // 4–16 items). Nothing to advance via voting.
    return;
  }

  const participantRow = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();
  const participantCount = participantRow?.count ?? 0;
  if (participantCount < 2) return; // need at least 2 players to ever close a round

  // For each real matchup, count votes. The round is ready when every real
  // matchup has at least `participantCount` votes from distinct voters.
  // (UNIQUE(matchup,voter) means each row is a distinct voter.)
  const voteCounts = await db
    .prepare(
      `SELECT matchup_id, COUNT(*) as c
       FROM matchup_votes
       WHERE room_id = ? AND matchup_id IN (${realMatchups.map(() => "?").join(",")})
       GROUP BY matchup_id`
    )
    .bind(roomId, ...realMatchups.map((m) => m.id))
    .all<{ matchup_id: string; c: number }>();

  const countByMatchup = new Map(voteCounts.results.map((r) => [r.matchup_id, r.c]));
  for (const m of realMatchups) {
    if ((countByMatchup.get(m.id) ?? 0) < participantCount) return; // not ready
  }

  // All real matchups are ready. Decide each one (skip if already decided —
  // makes this idempotent under concurrent triggers).
  const decisions: { matchupId: string; winnerId: string; tiebreak: boolean }[] = [];
  for (const m of realMatchups) {
    if (m.winner_item_id) continue; // already decided

    const tallies = await db
      .prepare(
        "SELECT picked_item_id, COUNT(*) as c FROM matchup_votes WHERE matchup_id = ? GROUP BY picked_item_id"
      )
      .bind(m.id)
      .all<{ picked_item_id: string; c: number }>();

    let aCount = 0, bCount = 0;
    for (const t of tallies.results) {
      if (t.picked_item_id === m.item_a_id) aCount = t.c;
      else if (t.picked_item_id === m.item_b_id) bCount = t.c;
    }

    let winnerId: string;
    let tiebreak = false;
    if (aCount > bCount) {
      winnerId = m.item_a_id!;
    } else if (bCount > aCount) {
      winnerId = m.item_b_id!;
    } else {
      // Coin flip
      tiebreak = true;
      winnerId = Math.random() < 0.5 ? m.item_a_id! : m.item_b_id!;
    }
    decisions.push({ matchupId: m.id, winnerId, tiebreak });
  }

  if (decisions.length === 0) {
    // Another concurrent call already decided everything. Still need to check
    // whether to create next round (skipped below if next-round rows exist).
  }

  const nowIso = new Date().toISOString();
  const statements: any[] = decisions.map((d) =>
    db
      .prepare(
        "UPDATE matchups SET winner_item_id = ?, decided_by_tiebreak = ?, decided_at = ? WHERE id = ? AND winner_item_id IS NULL"
      )
      .bind(d.winnerId, d.tiebreak ? 1 : 0, nowIso, d.matchupId)
  );

  // Build next round, or close the bracket.
  const nextRoundExists = await db
    .prepare("SELECT 1 FROM matchups WHERE room_id = ? AND round = ? LIMIT 1")
    .bind(roomId, round + 1)
    .first();

  if (!nextRoundExists) {
    // Pair winners of this round into next-round matchups.
    // Re-fetch winners (including byes and just-decided real matchups).
    const allThisRound = await getMatchupsByRoomAndRound(db, roomId, round);
    const winnerBySlot = new Map<number, string>();
    for (const m of allThisRound) {
      if (m.winner_item_id) winnerBySlot.set(m.slot, m.winner_item_id);
    }
    for (const d of decisions) {
      const slot = realMatchups.find((m) => m.id === d.matchupId)!.slot;
      winnerBySlot.set(slot, d.winnerId);
    }

    const nextSlotCount = allThisRound.length / 2;

    if (nextSlotCount === 0) {
      // This round was the final — transition room to revealed.
      statements.push(
        db
          .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
          .bind(roomId)
      );
    } else {
      for (let slot = 0; slot < nextSlotCount; slot++) {
        const winnerA = winnerBySlot.get(slot * 2)!;
        const winnerB = winnerBySlot.get(slot * 2 + 1)!;
        statements.push(
          db
            .prepare(
              "INSERT INTO matchups (id, room_id, round, slot, item_a_id, item_b_id, is_bye) VALUES (?, ?, ?, ?, ?, ?, 0)"
            )
            .bind(crypto.randomUUID(), roomId, round + 1, slot, winnerA, winnerB)
        );
      }
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}
```

- [ ] **Step 2: Mount the new router in `apps/api/src/index.ts`**

Replace the imports and route registration:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "./types";
import { rooms } from "./routes/rooms";
import { votes } from "./routes/votes";
import { results } from "./routes/results";
import { rankings } from "./routes/rankings";
import { bracket } from "./routes/bracket";

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
app.route("/api/rooms", bracket);

export default app;
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/bracket.ts apps/api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): add bracket router with /bracket and /matchup-votes

- GET /:code/bracket returns past + current rounds (future rounds
  aren't materialized, so clients can't peek ahead). Vote breakdowns
  exposed only for past rounds, never the in-flight current round.
- POST /:code/matchup-votes inserts a single vote with UNIQUE
  (matchup,voter) enforcement, validates the matchup is in the
  current round and pickedItemId is one of the two competitors.
- maybeAdvanceRound tallies all real matchups when every participant
  has voted, decides ties via server coin flip (decided_by_tiebreak=1),
  then either creates the next round's matchups or transitions the
  room to 'revealed' when the final is decided. Idempotent under
  concurrent triggers.
EOF
)"
```

---

### Task 5: Update `routes/results.ts` — mode-aware `/status` and `/results`

**Files:**
- Modify: `apps/api/src/routes/results.ts`

- [ ] **Step 1: Update `/status` — add `currentRound` field for bracket rooms, mode-aware completion**

Find the existing handler:

```ts
results.get("/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const totalItems = await getItemCount(db, room.id);

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

  const completedCount = voters.filter((v) => v.completed).length;

  const totalVoters = voters.length;

  return Response.json({
    totalVoters,
    completedCount,
    isRevealed: room.status === "revealed",
    voters,
  });
});
```

Replace it with bracket-aware logic:

```ts
results.get("/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  if (room.mode === "bracket") {
    return getBracketStatus(c, db, room);
  }

  const totalItems = await getItemCount(db, room.id);

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

  const completedCount = voters.filter((v) => v.completed).length;
  const totalVoters = voters.length;

  return Response.json({
    totalVoters,
    completedCount,
    isRevealed: room.status === "revealed",
    voters,
  });
});

async function getBracketStatus(c: any, db: D1Database, room: Room) {
  // For bracket: a participant is "complete" for the round when they have
  // voted on every real (non-bye) matchup in the current round. The
  // completedCount surfaces per-round progress, not whole-game progress.
  // The reveal trigger is room.status === 'revealed' (independent).
  const currentRound = room.status === "revealed" ? null : await getCurrentRound(db, room.id);

  const { results: participants } = await db
    .prepare(
      "SELECT voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string }>();

  let voters: { name: string; completed: boolean }[];
  let completedCount: number;

  if (currentRound === null) {
    // Revealed — everyone counts as done.
    voters = participants.map((p) => ({ name: p.voter_name, completed: true }));
    completedCount = voters.length;
  } else {
    const roundMatchups = await getMatchupsByRoomAndRound(db, room.id, currentRound);
    const realIds = roundMatchups.filter((m) => !m.is_bye).map((m) => m.id);
    const required = realIds.length;

    if (required === 0) {
      // Degenerate (shouldn't happen): no real matchups in current round.
      voters = participants.map((p) => ({ name: p.voter_name, completed: true }));
      completedCount = voters.length;
    } else {
      const placeholders = realIds.map(() => "?").join(",");
      const { results: voteRows } = await db
        .prepare(
          `SELECT voter_id, COUNT(*) as c FROM matchup_votes
           WHERE room_id = ? AND matchup_id IN (${placeholders})
           GROUP BY voter_id`
        )
        .bind(room.id, ...realIds)
        .all<{ voter_id: string; c: number }>();

      const countByVoter = new Map(voteRows.map((r) => [r.voter_id, r.c]));
      voters = participants.map((p) => ({
        name: p.voter_name,
        completed: (countByVoter.get(p.voter_id) ?? 0) >= required,
      }));
      completedCount = voters.filter((v) => v.completed).length;
    }
  }

  return Response.json({
    totalVoters: voters.length,
    completedCount,
    isRevealed: room.status === "revealed",
    currentRound,
    voters,
  });
}
```

Update the import line at the top of the file to include the new helpers:

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

- [ ] **Step 2: Update `/results` — dispatch bracket mode**

Find the existing dispatch:

```ts
if (room.mode === "rank") {
  return getRankResults(c, db, room, voterId);
}
return getVoteResults(c, db, room);
```

Replace with:

```ts
if (room.mode === "rank") {
  return getRankResults(c, db, room, voterId);
}
if (room.mode === "bracket") {
  return getBracketResults(c, db, room);
}
return getVoteResults(c, db, room);
```

Add the bracket helper after `getRankResults`:

```ts
async function getBracketResults(c: any, db: D1Database, room: Room) {
  if (room.status !== "revealed") {
    // Mirror the rank "not yet revealed" shape, with mode discriminator.
    const currentRound = await getCurrentRound(db, room.id);
    const roundMatchups = await getMatchupsByRoomAndRound(db, room.id, currentRound);
    const realCount = roundMatchups.filter((m) => !m.is_bye).length;
    const participantsRow = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();
    const totalVoters = participantsRow?.count ?? 0;

    return Response.json({
      revealed: false,
      mode: "bracket",
      currentRound,
      totalVoters,
      completedCount: 0,
      totalThisRound: realCount,
    });
  }

  // Revealed: build full bracket payload with vote breakdowns.
  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const N = items.length;
  let P = 1;
  while (P < N) P *= 2;
  const totalRounds = Math.log2(P);

  const allMatchups = await getMatchupsByRoom(db, room.id);
  const allVotes = await getMatchupVotesByRoom(db, room.id);
  const votesByMatchup = new Map<string, { voterId: string; voterName: string; pickedItemId: string }[]>();
  for (const v of allVotes) {
    if (!votesByMatchup.has(v.matchup_id)) votesByMatchup.set(v.matchup_id, []);
    votesByMatchup.get(v.matchup_id)!.push({
      voterId: v.voter_id,
      voterName: v.voter_name,
      pickedItemId: v.picked_item_id,
    });
  }

  const byRound = new Map<number, Matchup[]>();
  for (const m of allMatchups) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }
  for (const list of byRound.values()) list.sort((a, b) => a.slot - b.slot);

  const rounds = [...byRound.keys()].sort((a, b) => a - b).map((round) => ({
    round,
    matchups: byRound.get(round)!.map((m) => ({
      id: m.id,
      slot: m.slot,
      itemA: m.item_a_id ? { id: m.item_a_id, title: titleById.get(m.item_a_id) ?? "" } : null,
      itemB: m.item_b_id ? { id: m.item_b_id, title: titleById.get(m.item_b_id) ?? "" } : null,
      winner: m.winner_item_id ? { id: m.winner_item_id, title: titleById.get(m.winner_item_id) ?? "" } : null,
      isBye: !!m.is_bye,
      decidedByTiebreak: !!m.decided_by_tiebreak,
      voteBreakdown: votesByMatchup.get(m.id) ?? [],
    })),
  }));

  // Winner is the winner of the final round's only matchup.
  const finalRound = byRound.get(totalRounds) ?? [];
  const finalMatchup = finalRound[0];
  const winner = finalMatchup?.winner_item_id
    ? { id: finalMatchup.winner_item_id, title: titleById.get(finalMatchup.winner_item_id) ?? "" }
    : null;

  return Response.json({
    revealed: true,
    mode: "bracket",
    topic: room.topic,
    totalRounds,
    winner,
    rounds,
  });
}
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/routes/results.ts
git commit -m "$(cat <<'EOF'
feat(api): mode-aware /status and /results for bracket rooms

- /status returns currentRound for bracket rooms; per-voter completion
  is whether they've voted on every real matchup in the current round.
- /results dispatches: bracket mode returns rounds[] with full
  matchups (including byes and tiebreak labels) and a winner field.
  Vote breakdowns included for every matchup once revealed.
- Unrevealed bracket /results returns mode:'bracket' progress shape
  so clients can render the right loading state.
EOF
)"
```

---

### Task 6: Manual API integration test

**Files:** none (verification only)

- [ ] **Step 1: Start the local API**

```bash
cd apps/api && npx wrangler dev
```

Wait for `Ready on http://localhost:8787`.

- [ ] **Step 2: Create a bracket room (new terminal)**

```bash
curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"Best pizza topping","mode":"bracket","creatorVoterId":"voter-host","creatorName":"Host"}' \
  | python -m json.tool
```

Expected: JSON with `"mode": "bracket"` and a `"code"`. Save it:

```bash
ROOM=<code-from-response>
```

- [ ] **Step 3: Add 7 items (will produce 1 bye)**

```bash
for t in Pepperoni Mushroom Sausage Pineapple Anchovy Olives Bacon; do
  curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/items" \
    -H "Content-Type: application/json" \
    -d "{\"item\":\"$t\",\"creatorVoterId\":\"voter-host\"}" > /dev/null
done
curl -s "http://localhost:8787/api/rooms/$ROOM?voterId=voter-host" | python -m json.tool
```

Expected: 7 items in response.

- [ ] **Step 4: Verify 17th item is rejected**

```bash
for t in T1 T2 T3 T4 T5 T6 T7 T8 T9; do
  curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/items" \
    -H "Content-Type: application/json" \
    -d "{\"item\":\"$t\",\"creatorVoterId\":\"voter-host\"}" > /dev/null
done
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/items" \
  -H "Content-Type: application/json" \
  -d '{"item":"OverLimit","creatorVoterId":"voter-host"}'
echo
```

Expected: the last call returns `VALIDATION_ERROR` about exceeding the limit of 16.

(Skip if you want to keep 7 items — make a fresh room for this check instead. The rest of the test assumes 7 items.)

- [ ] **Step 5: Join a second participant**

```bash
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/join" \
  -H "Content-Type: application/json" \
  -d '{"voterId":"voter-bob","voterName":"Bob"}'
echo
```

Expected: `{"success":true}`.

- [ ] **Step 6: Start the room**

```bash
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/start" \
  -H "Content-Type: application/json" \
  -d '{"creatorVoterId":"voter-host"}'
echo
```

Expected: `{"success":true,"status":"voting","itemCount":7,"mode":"bracket"}`.

- [ ] **Step 7: Inspect Round 1 — expect 3 real matchups + 1 bye**

```bash
curl -s "http://localhost:8787/api/rooms/$ROOM/bracket?voterId=voter-host" | python -m json.tool
```

Expected: `currentRound: 1`, `totalRounds: 3`, `rounds` has one entry with `round: 1` containing 4 matchups; 3 of them have both `itemA` and `itemB` populated and `isBye: false`, 1 has `itemA` only, `isBye: true`, and `winner` already set.

- [ ] **Step 8: Both players vote on every real matchup of Round 1**

```bash
vote_round() {
  local voter=$1 name=$2
  local matchups=$(curl -s "http://localhost:8787/api/rooms/$ROOM/bracket?voterId=$voter")
  echo "$matchups" | python -c "
import json, sys, subprocess
data = json.load(sys.stdin)
current = data['currentRound']
for r in data['rounds']:
    if r['round'] != current: continue
    for m in r['matchups']:
        if m['isBye']: continue
        if m['id'] in data['myVotes']: continue
        # Always pick itemA for determinism
        body = json.dumps({
            'matchupId': m['id'], 'voterId': '$voter', 'voterName': '$name',
            'pickedItemId': m['itemA']['id']
        })
        subprocess.run(['curl', '-s', '-X', 'POST',
                        'http://localhost:8787/api/rooms/$ROOM/matchup-votes',
                        '-H', 'Content-Type: application/json',
                        '-d', body], check=True, stdout=subprocess.DEVNULL)
"
  echo "$name voted in current round"
}

vote_round voter-host Host
vote_round voter-bob Bob
```

Expected: both `voted in current round` lines print. After Bob's votes, the server advances to Round 2.

- [ ] **Step 9: Verify Round 2 exists, has 2 matchups, and the bye-advancer is in it**

```bash
curl -s "http://localhost:8787/api/rooms/$ROOM/bracket?voterId=voter-host" | python -m json.tool
```

Expected: `currentRound: 2`, `rounds` now has entries for round 1 (with vote breakdowns) AND round 2 (with `winner: null` on its matchups, no `voteBreakdown`). Round 1 vote breakdowns are populated; Round 2 matchups have no breakdowns (current round).

- [ ] **Step 10: Both players vote Round 2 → Round 3 (final)**

```bash
vote_round voter-host Host
vote_round voter-bob Bob
curl -s "http://localhost:8787/api/rooms/$ROOM/bracket?voterId=voter-host" | python -m json.tool
```

Expected: `currentRound: 3`, rounds 1 and 2 fully decided (vote breakdowns visible), round 3 has 1 matchup with no winner yet.

- [ ] **Step 11: Both vote the final → status reveals**

```bash
vote_round voter-host Host
vote_round voter-bob Bob
curl -s "http://localhost:8787/api/rooms/$ROOM/status" | python -m json.tool
curl -s "http://localhost:8787/api/rooms/$ROOM/results?voterId=voter-host" | python -m json.tool
```

Expected: `/status` shows `isRevealed: true`, `currentRound: null`. `/results` shows `revealed: true`, `mode: "bracket"`, `winner: {id, title}`, and `rounds` populated for rounds 1-3 with vote breakdowns on every matchup.

- [ ] **Step 12: Verify tie-breaking works**

Create a new room with 4 items, 2 participants. Have each participant pick opposite sides of the same Round 1 matchup (one picks A, one picks B). Resolve and inspect:

```bash
TIE=$(curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"tie test","mode":"bracket","creatorVoterId":"vh","creatorName":"VH"}' \
  | python -c "import json,sys; print(json.load(sys.stdin)['code'])")
for t in A B C D; do
  curl -s -X POST "http://localhost:8787/api/rooms/$TIE/items" \
    -H "Content-Type: application/json" \
    -d "{\"item\":\"$t\",\"creatorVoterId\":\"vh\"}" > /dev/null
done
curl -s -X POST "http://localhost:8787/api/rooms/$TIE/join" \
  -H "Content-Type: application/json" -d '{"voterId":"vb","voterName":"Bob"}' > /dev/null
curl -s -X POST "http://localhost:8787/api/rooms/$TIE/start" \
  -H "Content-Type: application/json" -d '{"creatorVoterId":"vh"}' > /dev/null

# vh picks itemA for every matchup, vb picks itemB — guarantees ties
python <<EOF
import json, urllib.request
def get(url): return json.loads(urllib.request.urlopen(url).read())
def post(url, data):
    req = urllib.request.Request(url, data=json.dumps(data).encode(),
                                  headers={'Content-Type':'application/json'})
    return urllib.request.urlopen(req).read()

base = "http://localhost:8787/api/rooms/$TIE"
for voter, name, side in [("vh","VH","itemA"), ("vb","Bob","itemB")]:
    while True:
        b = get(f"{base}/bracket?voterId={voter}")
        if b["currentRound"] is None: break
        progress = False
        for r in b["rounds"]:
            if r["round"] != b["currentRound"]: continue
            for m in r["matchups"]:
                if m["isBye"] or m["id"] in b["myVotes"]: continue
                post(f"{base}/matchup-votes", {
                    "matchupId": m["id"], "voterId": voter,
                    "voterName": name, "pickedItemId": m[side]["id"]
                })
                progress = True
        if not progress: break
EOF

curl -s "http://localhost:8787/api/rooms/$TIE/results?voterId=vh" | python -m json.tool
```

Expected: every matchup in the response has `decidedByTiebreak: true`. The winner is whichever side the coin flip picked.

- [ ] **Step 13: Verify wrong-mode rejections**

```bash
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/votes" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"x","voterId":"voter-bob","voterName":"Bob","vote":"yes"}'
echo
curl -s -X POST "http://localhost:8787/api/rooms/$ROOM/rankings" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"x","voterId":"voter-bob","voterName":"Bob","rank":1}'
echo
```

Expected: both return `VALIDATION_ERROR`. The votes one mentions bracket/matchup-votes; the rankings one mentions "is not a blind rank room."

- [ ] **Step 14: Verify existing vote and rank modes still work**

Create a vote room and a rank room, walk through each, confirm they reveal correctly.

```bash
VOTE=$(curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"vote test","creatorVoterId":"vh","creatorName":"VH"}' \
  | python -c "import json,sys; print(json.load(sys.stdin)['code'])")
for t in A B C; do
  curl -s -X POST "http://localhost:8787/api/rooms/$VOTE/items" \
    -H "Content-Type: application/json" \
    -d "{\"item\":\"$t\",\"creatorVoterId\":\"vh\"}" > /dev/null
done
curl -s -X POST "http://localhost:8787/api/rooms/$VOTE/start" \
  -H "Content-Type: application/json" -d '{"creatorVoterId":"vh"}'
echo
```

Expected: vote room starts cleanly; no regressions.

- [ ] **Step 15: Commit (none — verification step)**

No code change. Stop or leave the wrangler dev process running for the mobile phase.

---

## Phase B — Mobile

### Task 7: Update `apps/mobile/lib/api.ts` — types and bracket client functions

**Files:**
- Modify: `apps/mobile/lib/api.ts`

- [ ] **Step 1: Add `'bracket'` to the mode unions**

Find every `mode: "vote" | "rank"` in the file and change to `mode: "vote" | "rank" | "bracket"`. These appear in:
- `CreateRoomResponse`
- `createRoom`'s `body.mode?` parameter
- `RoomResponse`
- The return type of `createRoom` (already covered via `CreateRoomResponse`)

After this step, every `mode` field accepts `'bracket'`.

- [ ] **Step 2: Add a `currentRound?: number | null` to `StatusResponse`**

Find:

```ts
export type StatusResponse = {
  totalVoters: number;
  completedCount: number;
  isRevealed: boolean;
  voters: { name: string; completed: boolean }[];
};
```

Replace with:

```ts
export type StatusResponse = {
  totalVoters: number;
  completedCount: number;
  isRevealed: boolean;
  currentRound?: number | null;
  voters: { name: string; completed: boolean }[];
};
```

- [ ] **Step 3: Add bracket types and client functions at the bottom of the file**

Append:

```ts
// --- Bracket endpoints ---

export type BracketMatchup = {
  id: string;
  slot: number;
  itemA: { id: string; title: string } | null;
  itemB: { id: string; title: string } | null;
  winner: { id: string; title: string } | null;
  isBye: boolean;
  decidedByTiebreak: boolean;
  voteBreakdown?: { voterId: string; voterName: string; pickedItemId: string }[];
};

export type BracketRound = {
  round: number;
  matchups: BracketMatchup[];
};

export type BracketResponse = {
  currentRound: number | null;
  totalRounds: number;
  rounds: BracketRound[];
  myVotes: Record<string, string>; // matchupId -> pickedItemId
};

export function getBracket(code: string, voterId: string) {
  return request<BracketResponse>(
    `/rooms/${code}/bracket?voterId=${encodeURIComponent(voterId)}`
  );
}

export type MatchupVoteResponse = {
  success: boolean;
  progress: { votedThisRound: number; totalThisRound: number };
};

export function submitMatchupVote(
  code: string,
  body: { matchupId: string; voterId: string; voterName: string; pickedItemId: string }
) {
  return request<MatchupVoteResponse>(`/rooms/${code}/matchup-votes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Bracket results ---

export type BracketResultsResponse =
  | {
      revealed: true;
      mode: "bracket";
      topic: string;
      totalRounds: number;
      winner: { id: string; title: string } | null;
      rounds: BracketRound[];
    }
  | {
      revealed: false;
      mode: "bracket";
      currentRound: number;
      totalVoters: number;
      completedCount: number;
      totalThisRound: number;
    };
```

Then extend the existing `ResultsResponse` union to include the bracket shape:

Find:

```ts
export type ResultsResponse =
  | { revealed: true; topic: string; totalVoters: number; results: {...}[]; }
  | { revealed: false; completedCount: number; totalVoters: number; }
  | RankResultsResponse;
```

Replace with:

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
  | RankResultsResponse
  | BracketResultsResponse;
```

- [ ] **Step 4: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/lib/api.ts
git commit -m "feat(mobile-api): add bracket types, getBracket, submitMatchupVote"
```

---

### Task 8: Add the third "Bracket" card to the mode picker

**Files:**
- Modify: `apps/mobile/app/create/mode.tsx`

- [ ] **Step 1: Add the third card**

Open `apps/mobile/app/create/mode.tsx`. After the existing "Blind Rank" `Animated.View` block, add:

```tsx
<Animated.View entering={FadeInDown.duration(400).delay(300).springify()}>
  <Pressable
    style={({ pressed }) => [styles.card, styles.cardBracket, pressed && styles.cardPressed]}
    onPress={() => router.push({ pathname: "/create", params: { mode: "bracket" } })}
  >
    <Text style={styles.cardEmoji}>⚔</Text>
    <Text style={styles.cardTitle}>Bracket</Text>
    <Text style={styles.cardDescription}>
      Items face off in a tournament. Each round, everyone votes on the matchups. See the bracket grow.
    </Text>
  </Pressable>
</Animated.View>
```

- [ ] **Step 2: Add the matching style**

In the `StyleSheet.create({ ... })` block, alongside `cardRank`, add:

```tsx
cardBracket: {
  borderColor: colors.amberLight,
},
```

(Uses the existing amber palette for visual distinction. If `colors.amberLight` does not exist in `lib/theme.ts`, use `colors.sand` instead.)

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/mode.tsx
git commit -m "feat(mobile): add bracket card to mode picker"
```

---

### Task 9: Update `create/index.tsx` — accept `mode=bracket`, keep suggestions hidden

**Files:**
- Modify: `apps/mobile/app/create/index.tsx`

- [ ] **Step 1: Broaden the mode type and pass through to API**

Find:

```tsx
const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
const mode: "vote" | "rank" = modeParam === "rank" ? "rank" : "vote";
```

Replace with:

```tsx
const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
const mode: "vote" | "rank" | "bracket" =
  modeParam === "rank" ? "rank" : modeParam === "bracket" ? "bracket" : "vote";
```

Find the `createRoom` call's `allowSuggestions`:

```tsx
allowSuggestions: mode === "vote" ? allowSuggestions : false,
```

This already evaluates to `false` for both `rank` and `bracket`. Leave it unchanged.

- [ ] **Step 2: Confirm the suggestions toggle wrap covers bracket**

Find the toggle wrap (added in the rank work):

```tsx
{mode === "vote" && (
  <View style={styles.toggleRow}>
    {/* ... */}
  </View>
)}
```

This already hides the toggle for both `rank` and `bracket`. Leave it unchanged.

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/index.tsx
git commit -m "feat(mobile): create screen accepts 'bracket' mode param"
```

---

### Task 10: Update `create/share.tsx` — 4–16 item cap, route to bracket screen on Start

**Files:**
- Modify: `apps/mobile/app/create/share.tsx`

- [ ] **Step 1: Broaden the mode state type**

Find:

```tsx
const [mode, setMode] = useState<"vote" | "rank">(modeParam === "rank" ? "rank" : "vote");
```

Replace with:

```tsx
const [mode, setMode] = useState<"vote" | "rank" | "bracket">(
  modeParam === "rank" ? "rank" : modeParam === "bracket" ? "bracket" : "vote"
);
```

- [ ] **Step 2: Update `maxItems` and `canStart` to handle bracket**

Find:

```tsx
const maxItems = mode === "rank" ? 5 : 15;
const canStart = mode === "rank" ? items.length === 5 : items.length >= 2;
```

Replace with:

```tsx
const maxItems =
  mode === "rank" ? 5 :
  mode === "bracket" ? 16 : 15;
const canStart =
  mode === "rank" ? items.length === 5 :
  mode === "bracket" ? items.length >= 4 && items.length <= 16 :
  items.length >= 2;
```

- [ ] **Step 3: Update the not-ready alert message**

Find inside `handleStart`:

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

Replace with:

```tsx
if (!canStart) {
  return Alert.alert(
    "Not ready",
    mode === "rank"
      ? "Blind rank rooms need exactly 5 items"
      : mode === "bracket"
      ? "Bracket rooms need between 4 and 16 items"
      : "Add at least 2 items to start voting"
  );
}
```

- [ ] **Step 4: Route to the bracket play screen on Start**

Find inside `handleStart`:

```tsx
router.replace({
  pathname: mode === "rank" ? "/room/[code]/rank" : "/room/[code]/swipe",
  params: { code, name, isCreator: "true" },
});
```

Replace with:

```tsx
router.replace({
  pathname:
    mode === "rank" ? "/room/[code]/rank" :
    mode === "bracket" ? "/room/[code]/bracket" :
    "/room/[code]/swipe",
  params: { code, name, isCreator: "true" },
});
```

- [ ] **Step 5: Update the Start button label**

Find:

```tsx
{loading ? "Starting..." : mode === "rank" ? "Start Ranking" : "Start Voting"}
```

Replace with:

```tsx
{loading
  ? "Starting..."
  : mode === "rank"
  ? "Start Ranking"
  : mode === "bracket"
  ? "Start Tournament"
  : "Start Voting"}
```

- [ ] **Step 6: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/create/share.tsx
git commit -m "feat(mobile): share screen handles bracket mode (4-16 items, routes to bracket screen)"
```

---

### Task 11: Update `lobby.tsx` and home rejoin to dispatch bracket rooms

**Files:**
- Modify: `apps/mobile/app/room/[code]/lobby.tsx`
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Dispatch from lobby when status transitions to `voting`**

In `apps/mobile/app/room/[code]/lobby.tsx`, find:

```tsx
} else if (room.status === "voting") {
  clearInterval(intervalRef.current);
  router.replace({
    pathname: room.mode === "rank" ? "/room/[code]/rank" : "/room/[code]/swipe",
    params: { code, name },
  });
  return;
}
```

Replace with:

```tsx
} else if (room.status === "voting") {
  clearInterval(intervalRef.current);
  router.replace({
    pathname:
      room.mode === "rank" ? "/room/[code]/rank" :
      room.mode === "bracket" ? "/room/[code]/bracket" :
      "/room/[code]/swipe",
    params: { code, name },
  });
  return;
}
```

- [ ] **Step 2: Same dispatch in home-rejoin**

In `apps/mobile/app/index.tsx`, find the section that rejoins an in-progress room. Look for an `if (room.status === "voting")` branch with `pathname: room.mode === "rank" ? "/room/[code]/rank" : "/room/[code]/swipe"`. Replace the same way:

```tsx
pathname:
  room.mode === "rank" ? "/room/[code]/rank" :
  room.mode === "bracket" ? "/room/[code]/bracket" :
  "/room/[code]/swipe",
```

(If there's a second `if (room.status === "open")` branch that routes the host to share/lobby, leave that alone — it doesn't need a mode-specific dispatch for the open state.)

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/lobby.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): lobby and home-rejoin dispatch to bracket screen for bracket rooms"
```

---

### Task 12: Build `MatchupCard.tsx` and the bracket play screen

**Files:**
- Create: `apps/mobile/components/MatchupCard.tsx`
- Create: `apps/mobile/app/room/[code]/bracket.tsx`
- Modify: `apps/mobile/app/_layout.tsx` (register new screens)

- [ ] **Step 1: Create `MatchupCard.tsx`**

```tsx
import { Pressable, Text, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Props = {
  title: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export default function MatchupCard({ title, selected, disabled, onPress }: Props) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (disabled) return;
    scale.value = withTiming(0.96, { duration: 80 }, () => {
      scale.value = withTiming(1, { duration: 120 });
    });
    onPress();
  };

  return (
    <Animated.View style={[styles.wrap, animStyle]}>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.card,
          selected && styles.cardSelected,
          pressed && !disabled && styles.cardPressed,
        ]}
      >
        <Text style={styles.title} numberOfLines={4} adjustsFontSizeToFit minimumFontScale={0.7}>
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.sand,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  cardSelected: {
    borderColor: colors.coral,
    backgroundColor: colors.coralLight,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: colors.sandLight,
  },
  title: {
    ...typography.h2,
    color: colors.charcoal,
    textAlign: "center",
  },
});
```

- [ ] **Step 2: Create the bracket play screen**

`apps/mobile/app/room/[code]/bracket.tsx`:

```tsx
import { useEffect, useState } from "react";
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
import MatchupCard from "../../../components/MatchupCard";
import {
  getRoom,
  getBracket,
  submitMatchupVote,
  ApiError,
  type BracketMatchup,
} from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { colors, spacing, typography } from "../../../lib/theme";

export default function BracketScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
  }>();

  const [topic, setTopic] = useState("");
  const [currentRound, setCurrentRound] = useState<number | null>(null);
  const [totalRounds, setTotalRounds] = useState(0);
  const [pending, setPending] = useState<BracketMatchup[]>([]); // current-round matchups I haven't voted on
  const [doneInRound, setDoneInRound] = useState(0); // total real matchups already voted on
  const [totalInRound, setTotalInRound] = useState(0); // total real matchups this round
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const navigateToWaiting = (lastVotedRound: number) => {
    router.replace({
      pathname: "/room/[code]/waiting",
      params: {
        code,
        name,
        isCreator: isCreator ?? "false",
        lastVotedRound: String(lastVotedRound),
      },
    });
  };

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      const room = await getRoom(code, voterId);
      if (room.mode !== "bracket") {
        setError("This room isn't a bracket room.");
        setLoading(false);
        return;
      }
      setTopic(room.topic);

      if (room.status === "revealed") {
        // Skip straight to results.
        router.replace({ pathname: "/room/[code]/results", params: { code, name } });
        return;
      }

      const bracket = await getBracket(code, voterId);
      setCurrentRound(bracket.currentRound);
      setTotalRounds(bracket.totalRounds);

      if (bracket.currentRound === null) {
        // Revealed between getRoom and getBracket.
        router.replace({ pathname: "/room/[code]/results", params: { code, name } });
        return;
      }

      const round = bracket.rounds.find((r) => r.round === bracket.currentRound);
      const realMatchups = round?.matchups.filter((m) => !m.isBye) ?? [];
      const myVotedIds = new Set(Object.keys(bracket.myVotes));
      const unvoted = realMatchups.filter((m) => !myVotedIds.has(m.id));

      setTotalInRound(realMatchups.length);
      setDoneInRound(realMatchups.length - unvoted.length);
      setPending(unvoted);

      if (unvoted.length === 0) {
        // I'm done with this round — go to waiting.
        navigateToWaiting(bracket.currentRound);
        return;
      }
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the bracket.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handlePick = async (pickedItemId: string) => {
    if (submitting || pending.length === 0 || !currentRound) return;
    setSubmitting(true);
    setSelectedItemId(pickedItemId);
    const matchup = pending[0];

    try {
      const voterId = await getVoterId();
      await submitMatchupVote(code, {
        matchupId: matchup.id,
        voterId,
        voterName: name,
        pickedItemId,
      });

      // Brief delay to let the selection animation play.
      await new Promise((r) => setTimeout(r, 250));

      const remaining = pending.slice(1);
      setDoneInRound((c) => c + 1);
      setSelectedItemId(null);

      if (remaining.length === 0) {
        // That was the last matchup in this round. Hop to waiting.
        navigateToWaiting(currentRound);
        return;
      }

      setPending(remaining);
    } catch (e: any) {
      setSelectedItemId(null);
      Alert.alert("Error", e instanceof ApiError ? e.message : "Couldn't submit your vote.");
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

  const current = pending[0];
  if (!current) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={1}>{topic}</Text>
        <Text style={styles.progress}>
          Round {currentRound}/{totalRounds} · Matchup {doneInRound + 1} of {totalInRound}
        </Text>
      </View>

      <Animated.View key={current.id} entering={FadeIn.duration(200)} style={styles.matchupArea}>
        <MatchupCard
          title={current.itemA?.title ?? "?"}
          selected={selectedItemId === current.itemA?.id}
          disabled={submitting}
          onPress={() => current.itemA && handlePick(current.itemA.id)}
        />
        <Text style={styles.vs}>vs</Text>
        <MatchupCard
          title={current.itemB?.title ?? "?"}
          selected={selectedItemId === current.itemB?.id}
          disabled={submitting}
          onPress={() => current.itemB && handlePick(current.itemB.id)}
        />
      </Animated.View>

      {doneInRound === 0 && (
        <Text style={styles.hint}>Tap a card to pick a winner</Text>
      )}
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
    marginBottom: spacing.lg,
    gap: 4,
  },
  topic: {
    ...typography.h2,
    color: colors.charcoal,
  },
  progress: {
    ...typography.bodyBold,
    color: colors.coral,
  },
  matchupArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.md,
  },
  vs: {
    ...typography.h2,
    color: colors.mist,
    alignSelf: "center",
    paddingHorizontal: 4,
  },
  hint: {
    ...typography.body,
    color: colors.mist,
    textAlign: "center",
    marginTop: spacing.md,
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

- [ ] **Step 3: Register the new screen in `_layout.tsx`**

Open `apps/mobile/app/_layout.tsx`. After the `room/[code]/rank` line, add:

```tsx
<Stack.Screen name="room/[code]/bracket" options={{ headerShown: false }} />
<Stack.Screen name="room/[code]/round-reveal" options={{ headerShown: false }} />
```

(The `round-reveal` screen will be created in Task 14 — declaring it now avoids a second touch.)

- [ ] **Step 4: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/components/MatchupCard.tsx apps/mobile/app/room/[code]/bracket.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): add MatchupCard component and bracket play screen"
```

---

### Task 13: Build the `BracketTree` component

**Files:**
- Create: `apps/mobile/components/BracketTree.tsx`

This component renders the bracket vertically (one row per round, oldest at the top). Used by both the round-reveal screen (Task 14) and the final results screen (Task 15). Tappable matchups expand to show vote breakdowns on results; round-reveal uses a non-tappable variant.

- [ ] **Step 1: Create `BracketTree.tsx`**

```tsx
import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { BracketRound } from "../lib/api";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Props = {
  rounds: BracketRound[];
  expandableBreakdowns?: boolean; // true on final results, false on between-round
  myVoterId?: string;
};

export default function BracketTree({ rounds, expandableBreakdowns, myVoterId }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      {rounds.map((r) => (
        <View key={r.round} style={styles.roundBlock}>
          <Text style={styles.roundLabel}>ROUND {r.round}</Text>
          <View style={styles.matchupList}>
            {r.matchups.map((m) => {
              const winnerIsA = m.winner?.id && m.winner.id === m.itemA?.id;
              const winnerIsB = m.winner?.id && m.winner.id === m.itemB?.id;
              const expandable = expandableBreakdowns && !!m.voteBreakdown && !m.isBye;
              const isExpanded = expandable && expandedId === m.id;

              return (
                <View key={m.id} style={styles.matchupRow}>
                  <Pressable
                    onPress={() => expandable && setExpandedId(isExpanded ? null : m.id)}
                    disabled={!expandable}
                    style={({ pressed }) => [
                      styles.matchupCard,
                      pressed && expandable && { opacity: 0.85 },
                    ]}
                  >
                    {m.isBye ? (
                      <View style={styles.byeRow}>
                        <Text style={[styles.side, styles.byeText]}>BYE</Text>
                        <Text style={styles.arrow}>→</Text>
                        <Text style={[styles.side, styles.winnerSide]} numberOfLines={1}>
                          {m.itemA?.title ?? "?"}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.pair}>
                        <Text
                          style={[styles.side, winnerIsA ? styles.winnerSide : styles.loserSide]}
                          numberOfLines={1}
                        >
                          {m.itemA?.title ?? "?"}
                        </Text>
                        <Text style={styles.vsLabel}>vs</Text>
                        <Text
                          style={[styles.side, winnerIsB ? styles.winnerSide : styles.loserSide]}
                          numberOfLines={1}
                        >
                          {m.itemB?.title ?? "?"}
                        </Text>
                      </View>
                    )}
                    {m.decidedByTiebreak && (
                      <Text style={styles.tiebreakLabel}>split decision · coin flip</Text>
                    )}
                  </Pressable>

                  {isExpanded && m.voteBreakdown && (
                    <View style={styles.breakdown}>
                      {m.voteBreakdown.map((v, i) => {
                        const pickedTitle =
                          v.pickedItemId === m.itemA?.id
                            ? m.itemA?.title
                            : v.pickedItemId === m.itemB?.id
                            ? m.itemB?.title
                            : "?";
                        const isMe = myVoterId && v.voterId === myVoterId;
                        return (
                          <Text key={i} style={[styles.breakdownLine, isMe && styles.breakdownMe]}>
                            {v.voterName}{isMe ? " (you)" : ""} → {pickedTitle}
                          </Text>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  roundBlock: {
    gap: spacing.sm,
  },
  roundLabel: {
    ...typography.tiny,
    color: colors.mist,
    letterSpacing: 1,
  },
  matchupList: {
    gap: spacing.sm,
  },
  matchupRow: {
    gap: spacing.xs,
  },
  matchupCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.soft,
  },
  pair: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  byeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  arrow: {
    ...typography.body,
    color: colors.mist,
  },
  side: {
    ...typography.body,
    flex: 1,
  },
  winnerSide: {
    color: colors.charcoal,
    fontWeight: "700",
  },
  loserSide: {
    color: colors.mist,
    textDecorationLine: "line-through",
  },
  byeText: {
    color: colors.mist,
    flex: 0,
    fontStyle: "italic",
  },
  vsLabel: {
    ...typography.caption,
    color: colors.mist,
    flex: 0,
  },
  tiebreakLabel: {
    ...typography.caption,
    color: colors.amber,
    marginTop: spacing.xs,
    fontStyle: "italic",
  },
  breakdown: {
    backgroundColor: colors.sandLight,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  breakdownLine: {
    ...typography.caption,
    color: colors.slate,
  },
  breakdownMe: {
    color: colors.coral,
    fontWeight: "700",
  },
});
```

(If `radius.sm` doesn't exist in `lib/theme.ts`, use `radius.md` instead. Same for any palette tokens — fall back to existing tokens.)

- [ ] **Step 2: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/components/BracketTree.tsx
git commit -m "feat(mobile): add BracketTree component for between-round and final reveals"
```

---

### Task 14: Build `round-reveal.tsx` and update `waiting.tsx` to detect round advance

**Files:**
- Create: `apps/mobile/app/room/[code]/round-reveal.tsx`
- Modify: `apps/mobile/app/room/[code]/waiting.tsx`

- [ ] **Step 1: Update `waiting.tsx` — bracket-aware label + round-advance detection**

Open `apps/mobile/app/room/[code]/waiting.tsx`. Update the imports — add `getBracket` and broaden the mode state:

Find:

```tsx
const [mode, setMode] = useState<"vote" | "rank">("vote");
```

Replace with:

```tsx
const [mode, setMode] = useState<"vote" | "rank" | "bracket">("vote");
```

Find:

```tsx
const { code, name, isCreator: isCreatorParam } = useLocalSearchParams<{
  code: string;
  name: string;
  isCreator?: string;
}>();
```

Replace with:

```tsx
const { code, name, isCreator: isCreatorParam, lastVotedRound } = useLocalSearchParams<{
  code: string;
  name: string;
  isCreator?: string;
  lastVotedRound?: string;
}>();
```

Find the poll function:

```tsx
const poll = async () => {
  try {
    const data = await getStatus(code);
    setStatus(data);
    if (data.isRevealed) {
      clearInterval(intervalRef.current);
      router.replace({
        pathname: "/room/[code]/results",
        params: { code, name },
      });
    }
  } catch (e) {
    // ...
  }
};
```

Replace with bracket-aware behavior:

```tsx
const poll = async () => {
  try {
    const data = await getStatus(code);
    setStatus(data);
    if (data.isRevealed) {
      clearInterval(intervalRef.current);
      router.replace({
        pathname: "/room/[code]/results",
        params: { code, name },
      });
      return;
    }
    // Bracket: when the server advances the round past lastVotedRound,
    // hop the player to the round-reveal screen.
    if (
      mode === "bracket" &&
      lastVotedRound &&
      typeof data.currentRound === "number" &&
      data.currentRound > Number(lastVotedRound)
    ) {
      clearInterval(intervalRef.current);
      router.replace({
        pathname: "/room/[code]/round-reveal",
        params: {
          code,
          name,
          isCreator: isCreatorParam ?? "false",
          completedRound: lastVotedRound,
        },
      });
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === "ROOM_NOT_FOUND") {
      clearInterval(intervalRef.current);
      Alert.alert("Room Expired", "This room no longer exists.", [
        { text: "OK", onPress: () => router.replace("/") },
      ]);
    }
  }
};
```

Find the status-label badge:

```tsx
{voter.completed ? "Done" : mode === "rank" ? "Ranking..." : "Swiping..."}
```

Replace with:

```tsx
{voter.completed
  ? "Done"
  : mode === "rank"
  ? "Ranking..."
  : mode === "bracket"
  ? "Voting..."
  : "Swiping..."}
```

Make sure the `useEffect` that fetches the room's mode picks up `bracket`. The existing block:

```tsx
useEffect(() => {
  (async () => {
    try {
      const room = await getRoom(code);
      setMode(room.mode);
    } catch {}
  })();
}, [code]);
```

is fine — `room.mode` is now `"vote" | "rank" | "bracket"` from the broadened type in Task 7. No change needed.

- [ ] **Step 2: Create `round-reveal.tsx`**

```tsx
import { useEffect, useState } from "react";
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
import Animated, { FadeInUp } from "react-native-reanimated";
import BracketTree from "../../../components/BracketTree";
import { getBracket, ApiError, type BracketRound } from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { colors, spacing, radius, typography, shadows } from "../../../lib/theme";

export default function RoundRevealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name, isCreator, completedRound } = useLocalSearchParams<{
    code: string;
    name: string;
    isCreator?: string;
    completedRound: string;
  }>();

  const completed = Number(completedRound);

  const [rounds, setRounds] = useState<BracketRound[]>([]);
  const [currentRound, setCurrentRound] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const voterId = await getVoterId();
      const data = await getBracket(code, voterId);
      // Include rounds 1..completed (decided rounds with vote breakdowns).
      // Also include the just-opened next round as a preview ("coming up").
      // The BracketTree shows whatever rounds we pass it.
      setRounds(data.rounds.filter((r) => r.round <= completed + 1));
      setCurrentRound(data.currentRound);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the bracket.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleContinue = () => {
    if (currentRound === null) {
      // Room was revealed by the time we loaded.
      router.replace({ pathname: "/room/[code]/results", params: { code, name } });
      return;
    }
    router.replace({
      pathname: "/room/[code]/bracket",
      params: { code, name, isCreator: isCreator ?? "false" },
    });
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
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Animated.Text entering={FadeInUp.duration(400)} style={styles.heading}>
        Round {completed} complete
      </Animated.Text>
      {currentRound !== null && currentRound > completed && (
        <Text style={styles.subheading}>Round {currentRound} is up next</Text>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <BracketTree rounds={rounds} expandableBreakdowns={false} />
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.continueButton, pressed && styles.continueButtonPressed]}
        onPress={handleContinue}
      >
        <Text style={styles.continueText}>
          {currentRound === null ? "See Final Results" : "Continue"}
        </Text>
      </Pressable>
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
  heading: {
    ...typography.h1,
    color: colors.coral,
    textAlign: "center",
  },
  subheading: {
    ...typography.body,
    color: colors.slate,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
  },
  continueButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.md,
    ...shadows.button,
  },
  continueButtonPressed: {
    backgroundColor: colors.coralDark,
    transform: [{ scale: 0.98 }],
  },
  continueText: {
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
    borderRadius: 16,
  },
  retryText: {
    color: colors.warmWhite,
    ...typography.bodyBold,
  },
});
```

- [ ] **Step 3: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/round-reveal.tsx apps/mobile/app/room/[code]/waiting.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add round-reveal screen and waiting-screen round-advance

- Waiting screen broadens mode state to include 'bracket', shows
  'Voting...' label, and routes to round-reveal when server's
  currentRound advances past the player's lastVotedRound.
- New round-reveal screen renders BracketTree for completed rounds
  (no expandable breakdowns), shows next round as 'coming up', and
  routes back to bracket screen on Continue (or results if revealed).
EOF
)"
```

---

### Task 15: Update `results.tsx` — dispatch on bracket mode, render final BracketTree

**Files:**
- Modify: `apps/mobile/app/room/[code]/results.tsx`

- [ ] **Step 1: Add a bracket data state and discriminator**

At the top of `ResultsScreen`, after the existing state declarations, add:

```tsx
type RevealedBracketResults = Extract<ResultsResponse, { revealed: true; mode: "bracket" }>;

const [bracketData, setBracketData] = useState<RevealedBracketResults | null>(null);
```

- [ ] **Step 2: Update `loadResults` to recognize bracket shape**

Find:

```tsx
if (!res.revealed) {
  setError("Results aren't ready yet. Waiting for everyone to finish.");
} else if ("mode" in res && res.mode === "rank") {
  setRankData(res);
} else {
  setVoteData(res as RevealedVoteResults);
}
```

Replace with:

```tsx
if (!res.revealed) {
  setError("Results aren't ready yet. Waiting for everyone to finish.");
} else if ("mode" in res && res.mode === "rank") {
  setRankData(res);
} else if ("mode" in res && res.mode === "bracket") {
  setBracketData(res as RevealedBracketResults);
} else {
  setVoteData(res as RevealedVoteResults);
}
```

- [ ] **Step 3: Update the error guard so bracket data also counts as loaded**

Find:

```tsx
if (error || (!voteData && !rankData)) {
```

Replace with:

```tsx
if (error || (!voteData && !rankData && !bracketData)) {
```

- [ ] **Step 4: Add the bracket render branch**

Right after the existing `if (rankData) { return ... }` block, add:

```tsx
if (bracketData) {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: spacing.xxl }}
    >
      <Animated.View entering={FadeInUp.duration(500).springify()} style={styles.winnerCard}>
        <Text style={styles.winnerLabel}>WINNER</Text>
        <Text style={styles.winnerTitle}>{bracketData.winner?.title ?? "—"}</Text>
      </Animated.View>

      <Animated.Text entering={FadeInDown.duration(400).delay(150)} style={styles.topic}>
        {bracketData.topic}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.duration(400).delay(200)} style={styles.meta}>
        {bracketData.totalRounds} rounds · tap a matchup to see who voted
      </Animated.Text>

      <View style={{ marginTop: spacing.lg }}>
        <BracketTree
          rounds={bracketData.rounds}
          expandableBreakdowns
          myVoterId={myVoterId}
        />
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
```

- [ ] **Step 5: Add `BracketTree` import**

At the top of the file, after the existing `RankPlayerCard` import, add:

```tsx
import BracketTree from "../../../components/BracketTree";
```

- [ ] **Step 6: Compile-check + commit**

```bash
cd apps/mobile && npx tsc --noEmit
git add apps/mobile/app/room/[code]/results.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): results screen renders bracket final reveal

- Detects revealed:true,mode:'bracket' results and renders BracketTree
  with expandable per-matchup vote breakdowns.
- Highlights the winner in a card at the top; tap-to-expand on each
  matchup shows who voted for what (the current voter is styled
  distinctly).
EOF
)"
```

---

### Task 16: End-to-end manual test (mobile)

**Files:** none (verification only)

- [ ] **Step 1: Start API and mobile dev servers**

In one terminal:

```bash
cd apps/api && npx wrangler dev
```

In another:

```bash
cd apps/mobile && npx expo start
```

- [ ] **Step 2: Walk a full bracket game on Expo web (or simulator)**

Plan: open the app in two browser windows (or one simulator + web) so you can play as host and a second participant.

1. Window A (host): Create → Mode picker → tap "Bracket" → enter topic and name → tap Next → add 7 items (creates a 1-bye bracket) → Share screen shows code.
2. Window B (participant): Join → enter code → enter name → lobby.
3. Window A: tap "Start Tournament" → bracket play screen, Round 1 begins. Vote on all 3 real matchups.
4. After Window A's last vote, it navigates to waiting screen.
5. Window B: lobby auto-routes to bracket play. Vote on all 3 R1 matchups.
6. After Window B's last vote, server advances → Window A and Window B both auto-route to **round-reveal** showing the R1 results.
7. Both windows tap Continue → R2 voting opens. Each window has 2 matchups to vote on.
8. Repeat through R2 reveal → R3 (final) voting.
9. After the final vote, both windows navigate to **results.tsx**: winner card at top, full bracket tree below, tap a matchup to expand vote breakdown.

Expected behaviors to verify:
- The voter's own name is bolded/colored when their pick is shown in an expanded breakdown.
- Bye matchup in Round 1 displays as "BYE → ItemName".
- If a matchup tied (force this by voting opposite sides in both windows), the reveal shows "split decision · coin flip".
- Round-reveal does NOT show vote breakdowns (it shows the bracket without tap-to-expand). Only final results expand.

- [ ] **Step 3: Confirm existing modes still work**

Create a Swipe Vote room and a Blind Rank room from the mobile app. Walk each through to results. Confirm no regressions.

- [ ] **Step 4: Test resume-after-close on bracket**

Start a bracket game, vote on one matchup, kill the app (or refresh the browser tab), reopen. The app should resume:
- If you were mid-round: bracket screen reloads, shows the next unvoted matchup.
- If you finished the round but it hadn't closed: bracket screen routes you to waiting.
- If you missed a round advance while away: the round-reveal screen (or directly the next round) loads cleanly.

- [ ] **Step 5: Commit (none — verification step)**

No code change. End of plan.

---

## Self-review

Spec coverage:
- Mode field on rooms accepts 'bracket' ✓ Tasks 1, 2
- 4-16 item count with random byes ✓ Task 2 step 3 (seeding) + Task 10 (UI cap)
- Sync rounds with shared bracket ✓ Tasks 4 (server) + 12/14 (client flow)
- Sequential matchup UX ✓ Task 12
- Random coin flip on ties ✓ Task 4 maybeAdvanceRound
- Between-round reveal screens ✓ Task 14
- Per-player Continue tap ✓ Task 14
- Hidden future matchups ✓ Task 4 (server doesn't materialize future rounds)
- Final reveal with vote breakdowns ✓ Tasks 5, 13, 15
- Resume after close ✓ Task 12 loadInitial uses myVotes to skip
- Late joiners gating ✓ Task 4 maybeAdvanceRound uses current participant count
- Wrong-mode rejections ✓ Tasks 2, 3
- Server-enforced "blind" (no future round leakage) ✓ Task 4

Placeholder scan: no TBDs, no "implement later," no naked test stubs. All code blocks are complete.

Type consistency: `BracketMatchup`, `BracketRound`, `BracketResponse`, `BracketResultsResponse` used consistently across Tasks 7, 12, 14, 15. Server matches client field names (camelCase JSON in responses, snake_case in DB). `currentRound` is `number | null` everywhere. `lastVotedRound` is a route param (string) parsed via `Number()`.

Ambiguity check: bye assignment is deterministic given the shuffle (positions N..P-1 in the shuffled list become byes). Round advance is idempotent via UNIQUE and `WHERE winner_item_id IS NULL`. Tiebreak uses `Math.random()` which is fine for non-cryptographic UX coin-flips on Cloudflare Workers.

Scope check: this plan is focused on a single mode addition. Same shape and size as the blind-rank plan that successfully shipped. Builds in one pass without needing decomposition into sub-projects.
