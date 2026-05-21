# Most Likely To Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth game mode (Most Likely To) alongside Swipe Vote, Blind Rank, and Bracket. Host seeds prompts from a curated library plus optional custom additions; each participant votes on which person in the room fits each prompt; results reveal prompt-by-prompt with a flip animation, finishing on a "Superlatives" leaderboard.

**Architecture:** Add `'mlt'` to the existing `mode` enum on rooms. Add one new table: `mlt_votes` (one row per voter per prompt, with a `target_voter_id` column identifying who they picked). Reuse `items` (prompts are items, `title` holds prompt text). Mode-specific behavior lives in `routes/mlt.ts` (new) and `app/room/[code]/mlt.tsx` + a dedicated `app/create/mlt-prompts.tsx` (new); existing modes are untouched. Reveal animation is pure client-side state — server returns the full payload once and the client paces the flip-through.

**Tech Stack:** Hono on Cloudflare Workers + D1 SQLite (API). Expo Router + React Native (mobile, cross-platform iOS/Android/web), Reanimated for animations. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-20-most-likely-to-game-mode-design.md`

**Testing note:** Project has no automated test infrastructure (per CLAUDE.md: "add after MVP"). Each task uses manual verification — curl + `wrangler dev` for the API; `npx expo start` for the mobile app. Don't introduce a test framework unless the user asks.

---

## File map

**API — modify:**
- `apps/api/src/db/queries.ts` — extend `Room.mode` union to include `'mlt'`; add `MltVote` type and helpers
- `apps/api/src/db/schema.sql` — mirror the new `mlt_votes` table for fresh DBs
- `apps/api/src/routes/rooms.ts` — `/start` validates 3-15 items + ≥3 participants for mlt; `GET /:code` returns `myMltVotes`
- `apps/api/src/routes/votes.ts` — reject mlt rooms
- `apps/api/src/routes/rankings.ts` — reject mlt rooms
- `apps/api/src/routes/bracket.ts` — reject mlt rooms (both `/bracket` and `/matchup-votes`)
- `apps/api/src/routes/results.ts` — `/status` and `/results` dispatch on `mode === 'mlt'`
- `apps/api/src/index.ts` — mount the new mlt router

**API — create:**
- `apps/api/migrations/0007_mlt_mode.sql`
- `apps/api/src/lib/mlt-prompts.ts` — curated prompt library
- `apps/api/src/routes/mlt.ts` — `GET /mlt/prompts`, `POST /:code/mlt-votes`

**Mobile — modify:**
- `apps/mobile/lib/api.ts` — add `'mlt'` to mode unions; add mlt client functions and types
- `apps/mobile/app/_layout.tsx` — register `room/[code]/mlt` and `create/mlt-prompts`
- `apps/mobile/app/create/mode.tsx` — add the fourth "Most Likely To" card
- `apps/mobile/app/create/index.tsx` — accept `mode=mlt`; hide suggestions toggle; route to mlt-prompts screen
- `apps/mobile/app/create/share.tsx` — for mlt: gate Start on ≥3 prompts AND ≥3 participants, route to `/room/[code]/mlt` on Start
- `apps/mobile/app/room/[code]/lobby.tsx` — dispatch to mlt screen when status becomes `voting`
- `apps/mobile/app/room/[code]/waiting.tsx` — mode-aware label
- `apps/mobile/app/room/[code]/results.tsx` — branch on `mode === 'mlt'` for per-prompt reveal + leaderboard
- `apps/mobile/app/index.tsx` — home-rejoin honors mlt mode

**Mobile — create:**
- `apps/mobile/app/create/mlt-prompts.tsx` — library + custom prompt selection screen
- `apps/mobile/app/room/[code]/mlt.tsx` — prompt-card + player-tile voting screen
- `apps/mobile/components/PlayerTile.tsx` — tappable player tile used in mlt.tsx
- `apps/mobile/components/MltRevealCard.tsx` — flip-to-reveal card used in results.tsx
- `apps/mobile/lib/player-colors.ts` — 8-color palette + index-to-color helper

---

## Phase A — API

### Task 1: Migration, types, query helpers, prompt library

**Files:**
- Create: `apps/api/migrations/0007_mlt_mode.sql`
- Modify: `apps/api/src/db/schema.sql`
- Modify: `apps/api/src/db/queries.ts`
- Create: `apps/api/src/lib/mlt-prompts.ts`

- [ ] **Step 1: Write the migration**

Create `apps/api/migrations/0007_mlt_mode.sql`:

```sql
-- The `mode` column already exists (added in 0005). Allowed values become
-- 'vote' | 'rank' | 'bracket' | 'mlt' — no schema constraint, the app enforces it.

CREATE TABLE mlt_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  target_voter_id TEXT NOT NULL,
  target_voter_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);

CREATE INDEX idx_mlt_votes_room ON mlt_votes(room_id);
CREATE INDEX idx_mlt_votes_item ON mlt_votes(item_id);
CREATE INDEX idx_mlt_votes_room_voter ON mlt_votes(room_id, voter_id);
```

- [ ] **Step 2: Mirror the changes in `apps/api/src/db/schema.sql`**

Append to `apps/api/src/db/schema.sql` after the existing `matchup_votes` block (and before the `-- Indexes` block):

```sql
-- Most Likely To votes (mlt mode)
CREATE TABLE mlt_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  target_voter_id TEXT NOT NULL,
  target_voter_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)
);
```

Add these to the `-- Indexes` block at the bottom of the file:

```sql
CREATE INDEX idx_mlt_votes_room ON mlt_votes(room_id);
CREATE INDEX idx_mlt_votes_item ON mlt_votes(item_id);
CREATE INDEX idx_mlt_votes_room_voter ON mlt_votes(room_id, voter_id);
```

- [ ] **Step 3: Apply the migration locally**

Run from the repo root:

```bash
cd apps/api && npx wrangler d1 migrations apply tot-db --local
```

Expected output: `Migrations to be applied: 0007_mlt_mode.sql` followed by success.

- [ ] **Step 4: Extend the `Room` mode union in `apps/api/src/db/queries.ts`**

Find this exact text in `apps/api/src/db/queries.ts`:

```ts
  mode: "vote" | "rank" | "bracket";
```

Replace with:

```ts
  mode: "vote" | "rank" | "bracket" | "mlt";
```

- [ ] **Step 5: Add the `MltVote` type and helpers at the bottom of `apps/api/src/db/queries.ts`**

Append at the end of the file:

```ts
export type MltVote = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  target_voter_id: string;
  target_voter_name: string;
  created_at: string;
};

export async function getMltVotesByRoom(
  db: D1Database,
  roomId: string
): Promise<MltVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM mlt_votes WHERE room_id = ?")
    .bind(roomId)
    .all<MltVote>();
  return results;
}

export async function getMltVotesByVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<MltVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM mlt_votes WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<MltVote>();
  return results;
}
```

- [ ] **Step 6: Create the curated prompt library**

Create `apps/api/src/lib/mlt-prompts.ts`:

```ts
export type MltPrompt = {
  id: string;
  text: string;
  tags?: string[];
};

// Hand-curated prompts. Keep tone friend-group-friendly: no appearance, money,
// relationships, or sensitive topics. Drama lives in the voting, not the prompts.
// All entries lead with "Most likely to" so the host doesn't have to think about prefixing.
export const MLT_PROMPTS: MltPrompt[] = [
  { id: "ghost-group-chat", text: "Most likely to ghost the group chat for 3 days" },
  { id: "show-up-early", text: "Most likely to show up 30 minutes early to everything" },
  { id: "survive-zombie", text: "Most likely to survive a zombie apocalypse" },
  { id: "fall-asleep-movie", text: "Most likely to fall asleep during a movie" },
  { id: "talk-to-stranger", text: "Most likely to strike up a conversation with a stranger" },
  { id: "cry-at-pixar", text: "Most likely to cry at a Pixar movie" },
  { id: "lose-keys", text: "Most likely to lose their keys" },
  { id: "win-trivia", text: "Most likely to win a pub trivia night" },
  { id: "start-band", text: "Most likely to start a band" },
  { id: "become-famous", text: "Most likely to become famous" },
  { id: "run-marathon", text: "Most likely to run a marathon on a whim" },
  { id: "adopt-five-pets", text: "Most likely to adopt five pets" },
  { id: "forget-birthday", text: "Most likely to forget their own birthday" },
  { id: "binge-show", text: "Most likely to binge a whole show in one night" },
  { id: "miss-flight", text: "Most likely to miss a flight" },
  { id: "remember-trivia", text: "Most likely to remember a random fact from 10 years ago" },
  { id: "become-vegan", text: "Most likely to go vegan" },
  { id: "move-abroad", text: "Most likely to pack up and move abroad" },
  { id: "start-business", text: "Most likely to start their own business" },
  { id: "win-cookoff", text: "Most likely to win a cook-off" },
  { id: "burn-water", text: "Most likely to burn water trying to cook" },
  { id: "host-dinner-party", text: "Most likely to host the best dinner party" },
  { id: "give-speech", text: "Most likely to give an unforgettable wedding speech" },
  { id: "send-typo-text", text: "Most likely to send a text full of typos" },
  { id: "voice-of-reason", text: "Most likely to be the voice of reason" },
  { id: "make-everyone-laugh", text: "Most likely to make everyone laugh in any situation" },
  { id: "fix-anything", text: "Most likely to fix something with duct tape" },
  { id: "read-instructions", text: "Most likely to actually read the instructions" },
  { id: "argue-with-gps", text: "Most likely to argue with their GPS" },
  { id: "befriend-cat", text: "Most likely to befriend every cat in the neighborhood" },
  { id: "deep-question", text: "Most likely to ask a deep question at 2am" },
  { id: "leave-on-read", text: "Most likely to leave you on read" },
  { id: "double-text", text: "Most likely to double-text" },
  { id: "tell-bad-joke", text: "Most likely to tell the same joke twice" },
  { id: "explain-it-all", text: "Most likely to explain something in too much detail" },
  { id: "remember-everyones-name", text: "Most likely to remember everyone's name at a party" },
  { id: "make-the-playlist", text: "Most likely to make the road-trip playlist" },
  { id: "diy-disaster", text: "Most likely to attempt a DIY project and regret it" },
  { id: "buy-too-much", text: "Most likely to buy too much at the grocery store" },
  { id: "talk-to-pets", text: "Most likely to hold full conversations with their pets" },
  { id: "win-board-game", text: "Most likely to win a board game by accident" },
  { id: "flip-table-monopoly", text: "Most likely to flip the table during Monopoly" },
  { id: "ace-quiz", text: "Most likely to ace a random online quiz" },
  { id: "fall-down-rabbit-hole", text: "Most likely to fall down a Wikipedia rabbit hole" },
  { id: "wear-same-thing", text: "Most likely to wear the same outfit two days in a row" },
  { id: "lose-bet", text: "Most likely to lose a bet they were sure they'd win" },
  { id: "find-shortcut", text: "Most likely to find a shortcut everywhere" },
  { id: "save-the-day", text: "Most likely to save the day at the last minute" },
  { id: "rebook-vacation", text: "Most likely to rebook the same vacation every year" },
  { id: "try-new-hobby", text: "Most likely to pick up a new hobby every month" },
];
```

The IDs are stable strings so the client can later track favorites or analytics without using database IDs. Tags field is forward-looking and unused at launch.

- [ ] **Step 7: Verify the file compiles**

Run from the repo root:

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/migrations/0007_mlt_mode.sql apps/api/src/db/schema.sql apps/api/src/db/queries.ts apps/api/src/lib/mlt-prompts.ts
git commit -m "feat(api): mlt schema, types, and prompt library"
```

---

### Task 2: New routes file (`mlt.ts`) + mount

**Files:**
- Create: `apps/api/src/routes/mlt.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/routes/mlt.ts`**

```ts
import { createRouter } from "../types";
import {
  getRoomByCode,
  getItemCount,
} from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";
import { MLT_PROMPTS } from "../lib/mlt-prompts";

export const mlt = createRouter();

// GET /api/mlt/prompts — Returns the curated prompt library.
// Note: this is mounted at /api (not /api/rooms) — see index.ts.
mlt.get("/prompts", (c) => {
  return Response.json({ prompts: MLT_PROMPTS });
});

// POST /api/rooms/:code/mlt-votes — Submit or update a single mlt vote.
mlt.post("/:code/mlt-votes", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { itemId, voterId, voterName, targetVoterId } = body;

  if (!itemId || typeof itemId !== "string") {
    return validationError("itemId is required");
  }
  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (!targetVoterId || typeof targetVoterId !== "string") {
    return validationError("targetVoterId is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "mlt") {
    return validationError("This endpoint is only for Most Likely To rooms");
  }
  if (room.status !== "voting") {
    return invalidStatus("Votes can only be submitted while the room is in voting status");
  }

  // Verify the voter is a participant
  const voter = await db
    .prepare("SELECT voter_id, voter_name FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first<{ voter_id: string; voter_name: string }>();
  if (!voter) return validationError("Voter is not a participant of this room");

  // Verify the target is also a participant — and grab their current name
  const target = await db
    .prepare("SELECT voter_id, voter_name FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, targetVoterId)
    .first<{ voter_id: string; voter_name: string }>();
  if (!target) return validationError("Target is not a participant of this room");

  // Verify the prompt (item) belongs to this room
  const item = await db
    .prepare("SELECT id FROM items WHERE id = ? AND room_id = ?")
    .bind(itemId, room.id)
    .first();
  if (!item) return validationError("Prompt not found in this room");

  // Upsert: insert or update existing vote
  const existing = await db
    .prepare("SELECT id FROM mlt_votes WHERE item_id = ? AND voter_id = ?")
    .bind(itemId, voterId)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        "UPDATE mlt_votes SET target_voter_id = ?, target_voter_name = ?, voter_name = ? WHERE id = ?"
      )
      .bind(targetVoterId, target.voter_name, voterName.trim(), existing.id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO mlt_votes (id, room_id, item_id, voter_id, voter_name, target_voter_id, target_voter_name) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        room.id,
        itemId,
        voterId,
        voterName.trim(),
        targetVoterId,
        target.voter_name
      )
      .run();
  }

  // Progress for this voter
  const voterVotes = await db
    .prepare("SELECT COUNT(*) as count FROM mlt_votes WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first<{ count: number }>();
  const totalItems = await getItemCount(db, room.id);
  const voted = voterVotes?.count ?? 0;

  // Auto-reveal: when every participant has voted on every prompt.
  if (voted === totalItems) {
    await maybeReveal(db, room.id, totalItems);
  }

  return Response.json(
    { success: true, progress: { voted, total: totalItems } },
    { status: 201 }
  );
});

async function maybeReveal(db: D1Database, roomId: string, totalItems: number) {
  const participantCount = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();

  const completed = await db
    .prepare(
      `SELECT COUNT(*) as completed FROM (
        SELECT voter_id FROM mlt_votes WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= ?
      )`
    )
    .bind(roomId, totalItems)
    .first<{ completed: number }>();

  if ((completed?.completed ?? 0) >= (participantCount?.count ?? 0)) {
    await db
      .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
      .bind(roomId)
      .run();
  }
}
```

- [ ] **Step 2: Mount the new router in `apps/api/src/index.ts`**

Find this block:

```ts
import { bracket } from "./routes/bracket";
```

Add this line right after it:

```ts
import { mlt } from "./routes/mlt";
```

Then find:

```ts
app.route("/api/rooms", bracket);

export default app;
```

Replace with:

```ts
app.route("/api/rooms", bracket);
app.route("/api/rooms", mlt);
app.route("/api/mlt", mlt);

export default app;
```

This mounts the same router at two prefixes so `GET /api/mlt/prompts` works at the top level and `POST /api/rooms/:code/mlt-votes` lives under `/api/rooms`. Hono allows the same router to be mounted at multiple paths; the handlers are matched per-prefix.

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test the new endpoint**

Start the dev server:

```bash
cd apps/api && npx wrangler dev
```

In another shell, hit the library endpoint:

```bash
curl http://localhost:8787/api/mlt/prompts | head -50
```

Expected: JSON with a `prompts` array, ~50 entries each with `id` and `text`.

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mlt.ts apps/api/src/index.ts
git commit -m "feat(api): mlt routes + library endpoint"
```

---

### Task 3: Update `rooms.ts` for mlt mode

**Files:**
- Modify: `apps/api/src/routes/rooms.ts`

- [ ] **Step 1: Allow `'mlt'` as a valid mode in `POST /api/rooms`**

Open `apps/api/src/routes/rooms.ts` and find the validation block in the `POST /` handler that checks `body.mode`. It looks similar to:

```ts
  if (mode !== undefined && mode !== "vote" && mode !== "rank" && mode !== "bracket") {
    return validationError("mode must be 'vote', 'rank', or 'bracket'");
  }
```

Replace with:

```ts
  if (
    mode !== undefined &&
    mode !== "vote" &&
    mode !== "rank" &&
    mode !== "bracket" &&
    mode !== "mlt"
  ) {
    return validationError("mode must be 'vote', 'rank', 'bracket', or 'mlt'");
  }
```

If your local file's exact wording differs, follow the same pattern — accept `'mlt'` in the same place existing modes are accepted.

- [ ] **Step 2: Extend the item-count validation in `POST /:code/start`**

Find this block in `apps/api/src/routes/rooms.ts` (around line 200):

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
    if (itemCount < 2) {
      return validationError("Room must have at least 2 items to start voting");
    }
  }
```

- [ ] **Step 3: Extend the start-action mode branches**

Find the block right after the validation (around line 215) that branches on `room.mode === "rank"` and `room.mode === "bracket"` and falls through to `// vote mode: just flip status`. There is no special seeding work for mlt — items stay in their `sort_order`, no shuffling needed. The fall-through `vote mode` branch already does the right thing.

But the current code's `else` branch handles "vote mode" and runs only when mode is `'vote'`. The fall-through happens because no other branch matched. With mlt added, mlt falls into the same `else` branch — which is correct (just flip status). **No change needed here** — verify by reading the file: the structure is `if (room.mode === "rank") { ... } else if (room.mode === "bracket") { ... } else { /* flip status */ }`. The final `else` already covers both `vote` and `mlt`.

If your local version structures this differently (e.g., explicit `else if (room.mode === "vote")`), then add a parallel branch:

```ts
} else if (room.mode === "vote" || room.mode === "mlt") {
  await db
    .prepare("UPDATE rooms SET status = 'voting' WHERE id = ?")
    .bind(room.id)
    .run();
}
```

- [ ] **Step 4: Show mlt prompts to the creator pre-start in `GET /:code`**

Find this block in `apps/api/src/routes/rooms.ts` (around line 313):

```ts
  const showItemsForVoteMode =
    room.mode === "vote" &&
    (room.status !== "open" || isCreator || room.allow_suggestions);
  const showItemsForRankMode = room.mode === "rank" && room.status === "open" && isCreator;
  const showItemsForBracketMode = room.mode === "bracket" && room.status === "open" && isCreator;
  if (showItemsForVoteMode || showItemsForRankMode || showItemsForBracketMode) {
```

Replace with:

```ts
  const showItemsForVoteMode =
    room.mode === "vote" &&
    (room.status !== "open" || isCreator || room.allow_suggestions);
  const showItemsForRankMode = room.mode === "rank" && room.status === "open" && isCreator;
  const showItemsForBracketMode = room.mode === "bracket" && room.status === "open" && isCreator;
  const showItemsForMltMode =
    room.mode === "mlt" && (room.status !== "open" || isCreator);
  if (
    showItemsForVoteMode ||
    showItemsForRankMode ||
    showItemsForBracketMode ||
    showItemsForMltMode
  ) {
```

This shows prompts to the creator during room setup and to everyone once voting begins. Non-creators in the lobby see an empty items array (no prompt preview — matches bracket/rank behavior).

- [ ] **Step 5: Add `myMltVotes` to the `GET /:code` response**

Find this block near the bottom of the `GET /:code` handler (around line 339):

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

Replace with:

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

- [ ] **Step 6: Import the new helper**

At the top of `apps/api/src/routes/rooms.ts`, find the existing imports from `"../db/queries"` and add `getMltVotesByVoter` to the list. The existing import block looks like:

```ts
import {
  getRoomByCode,
  getItemsByRoomId,
  getItemCount,
  getVotesByRoomAndVoter,
  getRankingsByRoomAndVoter,
  // ...
} from "../db/queries";
```

Add `getMltVotesByVoter` to that import list.

- [ ] **Step 7: Verify it compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Smoke test room creation in mlt mode**

Start the dev server (`cd apps/api && npx wrangler dev`).

In another shell:

```bash
# Create an mlt room
curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"Friends roast","creatorVoterId":"creator-1","creatorName":"Alex","mode":"mlt"}' | jq

# Expect: { id, code, topic, mode: "mlt", ... }

# Add 3 prompts (replace CODE with the returned code)
CODE=PASTE_HERE
curl -s -X POST http://localhost:8787/api/rooms/$CODE/items \
  -H "Content-Type: application/json" \
  -d '{"items":["Most likely to lose their keys","Most likely to ghost the group chat","Most likely to win trivia"],"creatorVoterId":"creator-1"}' | jq

# Try to start with only 1 participant — should fail with "need at least 3 participants"
curl -s -X POST http://localhost:8787/api/rooms/$CODE/start \
  -H "Content-Type: application/json" \
  -d '{"creatorVoterId":"creator-1"}' | jq

# Expect: { error: { code: "VALIDATION_ERROR", message: "Most Likely To rooms need at least 3 participants to start" } }
```

Stop the dev server (Ctrl+C).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/rooms.ts
git commit -m "feat(api): accept mlt mode in rooms, gate start on 3 participants"
```

---

### Task 4: Reject mlt rooms in other vote routes

**Files:**
- Modify: `apps/api/src/routes/votes.ts`
- Modify: `apps/api/src/routes/rankings.ts`
- Modify: `apps/api/src/routes/bracket.ts`

- [ ] **Step 1: Reject mlt in `votes.ts`**

Open `apps/api/src/routes/votes.ts`. Find this block (around line 30):

```ts
  if (room.mode === "rank") {
    return validationError("This is a blind rank room — use /rankings instead of /votes");
  }
  if (room.mode === "bracket") {
    return validationError("This is a bracket room — use /matchup-votes instead of /votes");
  }
```

Add a third check below those:

```ts
  if (room.mode === "mlt") {
    return validationError("This is a Most Likely To room — use /mlt-votes instead of /votes");
  }
```

- [ ] **Step 2: Reject mlt in `rankings.ts`**

Open `apps/api/src/routes/rankings.ts`. There are typically two handlers (e.g. `POST /:code/rankings` and `GET /:code/next-item` or similar). For each handler, find where it checks `room.mode` and add an mlt guard. The pattern looks like:

```ts
  if (room.mode !== "rank") {
    return validationError("This endpoint is only for blind rank rooms");
  }
```

If it's already a strict equality check, **no change needed** — mlt is automatically rejected. If instead it uses negative checks like `if (room.mode === "vote")`, add an explicit mlt rejection alongside the others.

Read the file first. If the existing checks are exhaustive (`if (room.mode !== "rank") return ...`), skip to Step 3.

- [ ] **Step 3: Reject mlt in `bracket.ts`**

Open `apps/api/src/routes/bracket.ts`. Same as Step 2 — if handlers check `room.mode !== "bracket"`, no change is needed. If they use positive checks against other modes, add explicit mlt guards.

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

If any files changed:

```bash
git add apps/api/src/routes/votes.ts apps/api/src/routes/rankings.ts apps/api/src/routes/bracket.ts
git commit -m "feat(api): reject mlt rooms from non-mlt vote endpoints"
```

If nothing changed (all checks were already strict equality), skip the commit.

---

### Task 5: Update `results.ts` for mlt mode

**Files:**
- Modify: `apps/api/src/routes/results.ts`

- [ ] **Step 1: Branch `/status` on mlt mode**

Open `apps/api/src/routes/results.ts`. The existing `/status` handler already handles `rank`, `bracket`, and `vote` modes. For mlt, the completion check matches `vote` mode exactly: a voter is "complete" when their `mlt_votes` count equals the room's item count.

Find this block near the top of `results.get("/:code/status", ...)`:

```ts
  if (room.mode === "bracket") {
    return getBracketStatus(c, db, room);
  }

  const totalItems = await getItemCount(db, room.id);

  const submissionsTable = room.mode === "rank" ? "rankings" : "votes";
  const requiredCount = room.mode === "rank" ? 5 : totalItems;
```

Replace with:

```ts
  if (room.mode === "bracket") {
    return getBracketStatus(c, db, room);
  }

  const totalItems = await getItemCount(db, room.id);

  let submissionsTable: string;
  let requiredCount: number;
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

The rest of the handler (the COUNT query and response shape) works as-is for mlt.

- [ ] **Step 2: Branch `/results` on mlt mode**

Find this block:

```ts
  if (room.mode === "rank") {
    return getRankResults(c, db, room, voterId);
  }
  if (room.mode === "bracket") {
    return getBracketResults(c, db, room);
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
  if (room.mode === "mlt") {
    return getMltResults(c, db, room);
  }
  return getVoteResults(c, db, room);
```

- [ ] **Step 3: Add the `getMltResults` function**

Append at the bottom of `apps/api/src/routes/results.ts` (after `getBracketResults`):

```ts
async function getMltResults(c: any, db: D1Database, room: Room) {
  if (room.status !== "revealed") {
    // Mirror the rank "not yet revealed" shape, with mode discriminator.
    const totalParticipants = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();

    const totalItems = await getItemCount(db, room.id);

    const completed = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT voter_id FROM mlt_votes WHERE room_id = ? GROUP BY voter_id HAVING COUNT(*) >= ?
        )`
      )
      .bind(room.id, totalItems)
      .first<{ completed: number }>();

    return Response.json({
      revealed: false,
      mode: "mlt",
      completedCount: completed?.completed ?? 0,
      totalVoters: totalParticipants?.count ?? 0,
    });
  }

  // Revealed: build per-prompt tallies + winners + leaderboard
  const items = await getItemsByRoomId(db, room.id);

  // Pull all mlt votes for this room
  const { results: voteRows } = await db
    .prepare(
      "SELECT item_id, target_voter_id, target_voter_name FROM mlt_votes WHERE room_id = ?"
    )
    .bind(room.id)
    .all<{ item_id: string; target_voter_id: string; target_voter_name: string }>();

  // Pull participants (for stable tally ordering)
  const { results: participants } = await db
    .prepare(
      "SELECT voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string }>();

  // Tallies per (item, target)
  type ItemTallies = Map<string, { name: string; count: number }>;
  const talliesByItem = new Map<string, ItemTallies>();
  for (const item of items) talliesByItem.set(item.id, new Map());
  for (const v of voteRows) {
    const tallies = talliesByItem.get(v.item_id);
    if (!tallies) continue;
    const existing = tallies.get(v.target_voter_id);
    if (existing) {
      existing.count += 1;
    } else {
      tallies.set(v.target_voter_id, { name: v.target_voter_name, count: 1 });
    }
  }

  // Build per-prompt result + accumulate wins per voter
  const winsByVoter = new Map<string, { name: string; wins: number }>();
  for (const p of participants) {
    winsByVoter.set(p.voter_id, { name: p.voter_name, wins: 0 });
  }

  const prompts = items.map((item) => {
    const itemTallies = talliesByItem.get(item.id) ?? new Map();

    // All participants appear in the tally, including zero-vote ones
    const fullTallies = participants.map((p) => {
      const t = itemTallies.get(p.voter_id);
      return {
        targetVoterId: p.voter_id,
        name: t?.name ?? p.voter_name,
        count: t?.count ?? 0,
      };
    });

    fullTallies.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    const totalVotes = fullTallies.reduce((sum, t) => sum + t.count, 0);
    const topCount = fullTallies[0]?.count ?? 0;
    const winners =
      topCount === 0
        ? []
        : fullTallies
            .filter((t) => t.count === topCount)
            .map((t) => ({ voterId: t.targetVoterId, name: t.name }));

    // Credit each (sole or tied) winner with a leaderboard "win"
    for (const w of winners) {
      const row = winsByVoter.get(w.voterId);
      if (row) row.wins += 1;
    }

    return {
      itemId: item.id,
      text: item.title,
      sortOrder: item.sort_order,
      tallies: fullTallies,
      winners,
      totalVotes,
    };
  });

  const leaderboard = [...winsByVoter.entries()]
    .map(([voterId, row]) => ({ voterId, name: row.name, wins: row.wins }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    });

  return Response.json({
    revealed: true,
    mode: "mlt",
    topic: room.topic,
    prompts,
    leaderboard,
  });
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 5: Manual end-to-end API test**

Start the dev server (`cd apps/api && npx wrangler dev`).

In another shell, run this script (paste each block; replace `CODE` after creation):

```bash
# 1. Create mlt room
RESP=$(curl -s -X POST http://localhost:8787/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic":"Test","creatorVoterId":"v1","creatorName":"Alex","mode":"mlt"}')
echo $RESP | jq
CODE=$(echo $RESP | jq -r .code)
echo "Code: $CODE"

# 2. Add 3 prompts
curl -s -X POST http://localhost:8787/api/rooms/$CODE/items \
  -H "Content-Type: application/json" \
  -d '{"items":["Most likely to lose their keys","Most likely to win trivia","Most likely to ghost"],"creatorVoterId":"v1"}' | jq

# 3. Join two more participants
curl -s -X POST http://localhost:8787/api/rooms/$CODE/join \
  -H "Content-Type: application/json" \
  -d '{"voterId":"v2","voterName":"Bea"}' | jq
curl -s -X POST http://localhost:8787/api/rooms/$CODE/join \
  -H "Content-Type: application/json" \
  -d '{"voterId":"v3","voterName":"Cam"}' | jq

# 4. Start voting (should succeed now — 3 participants)
curl -s -X POST http://localhost:8787/api/rooms/$CODE/start \
  -H "Content-Type: application/json" \
  -d '{"creatorVoterId":"v1"}' | jq

# 5. Fetch room state and get prompt IDs
ROOM=$(curl -s "http://localhost:8787/api/rooms/$CODE?voterId=v1")
echo $ROOM | jq
ITEM1=$(echo $ROOM | jq -r '.items[0].id')
ITEM2=$(echo $ROOM | jq -r '.items[1].id')
ITEM3=$(echo $ROOM | jq -r '.items[2].id')

# 6. Each voter votes on all 3 prompts
for V in v1 v2 v3; do
  for ITEM in $ITEM1 $ITEM2 $ITEM3; do
    # Vote randomly for one of the participants
    TARGET=$(shuf -n1 -e v1 v2 v3)
    NAME=$(case $V in v1) echo Alex;; v2) echo Bea;; v3) echo Cam;; esac)
    curl -s -X POST http://localhost:8787/api/rooms/$CODE/mlt-votes \
      -H "Content-Type: application/json" \
      -d "{\"itemId\":\"$ITEM\",\"voterId\":\"$V\",\"voterName\":\"$NAME\",\"targetVoterId\":\"$TARGET\"}" > /dev/null
  done
done

# 7. Check results — should be revealed=true with prompts + leaderboard
curl -s "http://localhost:8787/api/rooms/$CODE/results" | jq
```

On Windows PowerShell, replace `shuf` with a manual choice or hard-code `TARGET=v1`. The point is to verify the full payload shape on `revealed=true`.

Expected: the final results call returns `{ revealed: true, mode: "mlt", topic, prompts: [...], leaderboard: [...] }` with each prompt showing `tallies` (3 entries each), `winners` (1+ entries), and the leaderboard with 3 entries summing to the total number of prompts (one win per prompt, possibly more if ties).

Stop the dev server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/results.ts
git commit -m "feat(api): mlt mode status and results payloads"
```

---

## Phase B — Mobile

### Task 6: API client functions and types

**Files:**
- Modify: `apps/mobile/lib/api.ts`

- [ ] **Step 1: Extend mode unions and add mlt types**

Open `apps/mobile/lib/api.ts`. Find every `"vote" | "rank" | "bracket"` union and extend it to include `"mlt"`. There are several:

- The `CreateRoomResponse` type's `mode` field
- The `createRoom` body's `mode` parameter
- Any `getRoom` response type with a `mode` field
- The results response discriminated union

Specifically:

Find:

```ts
export type CreateRoomResponse = {
  id: string;
  code: string;
  topic: string;
  mode: "vote" | "rank" | "bracket";
  createdAt: string;
  expiresAt: string;
};
```

Replace `mode: "vote" | "rank" | "bracket";` with `mode: "vote" | "rank" | "bracket" | "mlt";`

Find:

```ts
export function createRoom(body: {
  topic: string;
  creatorVoterId: string;
  creatorName: string;
  allowSuggestions?: boolean;
  mode?: "vote" | "rank" | "bracket";
}) {
```

Replace `mode?: "vote" | "rank" | "bracket";` with `mode?: "vote" | "rank" | "bracket" | "mlt";`

Do the same for any other `mode` union in the file. Use grep to find them: `grep -n '"vote" | "rank" | "bracket"' apps/mobile/lib/api.ts`.

- [ ] **Step 2: Add mlt-specific types and functions at the end of the file**

Append at the end of `apps/mobile/lib/api.ts`:

```ts
// --- Most Likely To endpoints ---

export type MltPrompt = {
  id: string;
  text: string;
  tags?: string[];
};

export type MltPromptsResponse = {
  prompts: MltPrompt[];
};

export function getMltPrompts() {
  return request<MltPromptsResponse>("/mlt/prompts");
}

export type SubmitMltVoteBody = {
  itemId: string;
  voterId: string;
  voterName: string;
  targetVoterId: string;
};

export type SubmitMltVoteResponse = {
  success: true;
  progress: { voted: number; total: number };
};

export function submitMltVote(code: string, body: SubmitMltVoteBody) {
  return request<SubmitMltVoteResponse>(`/rooms/${code}/mlt-votes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type MltPromptResult = {
  itemId: string;
  text: string;
  sortOrder: number;
  tallies: { targetVoterId: string; name: string; count: number }[];
  winners: { voterId: string; name: string }[];
  totalVotes: number;
};

export type MltLeaderboardEntry = {
  voterId: string;
  name: string;
  wins: number;
};

export type MltResultsRevealed = {
  revealed: true;
  mode: "mlt";
  topic: string;
  prompts: MltPromptResult[];
  leaderboard: MltLeaderboardEntry[];
};

export type MltResultsPending = {
  revealed: false;
  mode: "mlt";
  completedCount: number;
  totalVoters: number;
};
```

- [ ] **Step 3: Update the `ResultsResponse` union**

Find the existing `ResultsResponse` type (it's a discriminated union including the bracket and rank result types). Add `MltResultsRevealed` and `MltResultsPending` to the union. For example, if the union currently looks like:

```ts
export type ResultsResponse =
  | { revealed: true; topic: string; totalVoters: number; results: VoteResult[] }
  | { revealed: false; completedCount: number; totalVoters: number }
  | RankResultsRevealed
  | RankResultsPending
  | BracketResultsRevealed
  | BracketResultsPending;
```

Add `| MltResultsRevealed | MltResultsPending` at the end.

If the exact shape in your file differs, find every `revealed: true` or `revealed: false` variant in `ResultsResponse` and add the two mlt variants alongside.

- [ ] **Step 4: Verify it compiles**

From the repo root:

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/api.ts
git commit -m "feat(mobile): mlt mode types and API client"
```

---

### Task 7: Player colors utility + PlayerTile component

**Files:**
- Create: `apps/mobile/lib/player-colors.ts`
- Create: `apps/mobile/components/PlayerTile.tsx`

- [ ] **Step 1: Create the player colors utility**

Create `apps/mobile/lib/player-colors.ts`:

```ts
import { colors } from "./theme";

// Eight distinct colors for player identity. Beyond 8, indices wrap.
// Tints are paler backgrounds used for tile fills; the "color" is the bold border / accent.
export type PlayerColor = {
  base: string;
  tint: string;
  border: string;
  textOnBase: string;
};

export const PLAYER_COLORS: PlayerColor[] = [
  { base: colors.coral,    tint: "#FFE7DD", border: colors.coral,    textOnBase: "#fff" },
  { base: colors.teal,     tint: "#DDF0EE", border: colors.teal,     textOnBase: "#fff" },
  { base: colors.amber,    tint: "#FFF1D6", border: colors.amber,    textOnBase: "#3D2D00" },
  { base: "#7C6EF2",       tint: "#E6E3FB", border: "#7C6EF2",       textOnBase: "#fff" },
  { base: "#E26EAE",       tint: "#FBE3F1", border: "#E26EAE",       textOnBase: "#fff" },
  { base: "#5BAE6E",       tint: "#DEF0E1", border: "#5BAE6E",       textOnBase: "#fff" },
  { base: "#E2A86E",       tint: "#FBEDDD", border: "#E2A86E",       textOnBase: "#3D2D00" },
  { base: "#6E92E2",       tint: "#DDE6F8", border: "#6E92E2",       textOnBase: "#fff" },
];

export function getPlayerColor(index: number): PlayerColor {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}
```

The fallback colors (indices 3–7) are inline hex because `theme.ts` may not define enough named colors. Check `apps/mobile/lib/theme.ts` first — if it has more named colors (`indigo`, `pink`, `green`, etc.), prefer using them. The exact palette is not load-bearing; the requirement is 8 distinguishable colors.

- [ ] **Step 2: Create the PlayerTile component**

Create `apps/mobile/components/PlayerTile.tsx`:

```tsx
import { Pressable, Text, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { PlayerColor } from "../lib/player-colors";
import { radius, spacing, typography, shadows } from "../lib/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  name: string;
  color: PlayerColor;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
};

export default function PlayerTile({ name, color, selected, onPress, disabled }: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withSpring(0.95, { damping: 15 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15 });
      }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.tile,
        {
          backgroundColor: selected ? color.base : color.tint,
          borderColor: color.border,
        },
        animatedStyle,
      ]}
    >
      <Text
        style={[
          styles.name,
          { color: selected ? color.textOnBase : "#333" },
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 100,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.soft,
  },
  name: {
    ...typography.h3,
    textAlign: "center",
  },
});
```

If `typography.h3` doesn't exist in your `theme.ts`, fall back to `typography.body` or any larger named style — the goal is bold, legible tile text.

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/player-colors.ts apps/mobile/components/PlayerTile.tsx
git commit -m "feat(mobile): player color palette + PlayerTile component"
```

---

### Task 8: Add the fourth card to the mode picker

**Files:**
- Modify: `apps/mobile/app/create/mode.tsx`

- [ ] **Step 1: Add the MLT card**

Open `apps/mobile/app/create/mode.tsx`. The current file ends with a third `Animated.View` containing the bracket card. Add a fourth `Animated.View` right after it, before the closing `</ScrollView>`:

```tsx
      <Animated.View entering={FadeInDown.duration(400).delay(400).springify()}>
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardMlt, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/create", params: { mode: "mlt" } })}
        >
          <Text style={styles.cardEmoji}>★</Text>
          <Text style={styles.cardTitle}>Most Likely To</Text>
          <Text style={styles.cardDescription}>
            Pick prompts like "most likely to ghost the group chat." For each one, vote on
            the person in the room who fits it best.
          </Text>
        </Pressable>
      </Animated.View>
```

- [ ] **Step 2: Add the `cardMlt` style**

In the `StyleSheet.create({ ... })` block at the bottom of the same file, add a new style alongside `cardRank` and `cardBracket`:

```ts
  cardMlt: {
    borderColor: "#7C6EF2", // matches PLAYER_COLORS[3].border for thematic consistency
  },
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 4: Smoke test in the app**

Run `cd apps/mobile && npx expo start` and open the app on a simulator or web. Navigate Home → Create → mode picker. Confirm four cards appear and tapping "Most Likely To" navigates to the create screen.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/create/mode.tsx
git commit -m "feat(mobile): add Most Likely To card to mode picker"
```

---

### Task 9: Update the create flow setup screen for mlt

**Files:**
- Modify: `apps/mobile/app/create/index.tsx`

- [ ] **Step 1: Read the existing file**

Open `apps/mobile/app/create/index.tsx`. Note how it currently reads the `mode` param, hides/shows the "Allow suggestions" toggle, and on submit routes to either `/create/share` (for vote/bracket) or `/create/share` (for rank) — the routing target may vary.

- [ ] **Step 2: Accept `'mlt'` as a valid mode and hide the suggestions toggle**

Find where the mode is read from params, typically:

```ts
const { mode } = useLocalSearchParams<{ mode?: "vote" | "rank" | "bracket" }>();
```

Replace with:

```ts
const { mode } = useLocalSearchParams<{ mode?: "vote" | "rank" | "bracket" | "mlt" }>();
```

Find the conditional that hides the "Allow suggestions" toggle. It probably looks like:

```ts
const showSuggestionsToggle = mode === "vote";
```

OR something like:

```ts
{mode !== "rank" && mode !== "bracket" && (
  <SuggestionsToggle ... />
)}
```

Update it to also hide for mlt:

```ts
const showSuggestionsToggle = mode === "vote";
// (already excludes mlt because it's not 'vote')
```

If the condition is exclusion-based (`mode !== "rank" && mode !== "bracket"`), add `&& mode !== "mlt"`.

- [ ] **Step 3: Route to the prompt selection screen after room creation in mlt mode**

Find the submission handler (after `createRoom(...)` resolves). It probably routes to `/create/share` with the new room's code. For mlt, route to the new prompt-selection screen first:

```ts
// After createRoom resolves, e.g.:
const room = await createRoom({ topic, creatorVoterId, creatorName, mode });

if (mode === "mlt") {
  router.push({ pathname: "/create/mlt-prompts", params: { code: room.code } });
} else {
  router.push({ pathname: "/create/share", params: { code: room.code } });
}
```

If the existing routing logic already always goes through `/create/share` and `/create/share` then handles item-add for non-rank modes, an alternative is: keep routing to `/create/share` for mlt as well, but the share screen detects mlt mode and surfaces a "Pick prompts" CTA leading to the new screen. **Recommended:** route directly to `/create/mlt-prompts` from create so the host enters the curation flow immediately. The share screen is for after prompts are selected.

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/create/index.tsx
git commit -m "feat(mobile): create flow accepts mlt mode, routes to prompt picker"
```

---

### Task 10: Build the prompt selection screen

**Files:**
- Create: `apps/mobile/app/create/mlt-prompts.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Register the new route in the root layout**

Open `apps/mobile/app/_layout.tsx`. Find the `<Stack.Screen ... />` registrations for `create/share`, `create/index`, `create/mode`. Add a new entry:

```tsx
<Stack.Screen name="create/mlt-prompts" options={{ title: "Pick prompts", headerShown: false }} />
```

Use the same options shape as the existing `create/share` registration (copy-paste and adjust the `name`).

- [ ] **Step 2: Create the prompt selection screen**

Create `apps/mobile/app/create/mlt-prompts.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, Layout } from "react-native-reanimated";
import {
  getMltPrompts,
  addItems,
  ApiError,
  type MltPrompt,
} from "../../lib/api";
import { getVoterId } from "../../lib/storage";
import { colors, spacing, radius, typography, shadows } from "../../lib/theme";

const MAX_PROMPTS = 15;
const MAX_PROMPT_LENGTH = 80;
const PICK_FOR_ME_COUNT = 7;

type SelectedPrompt = { text: string; libraryId: string | null };

export default function MltPromptsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();

  const [library, setLibrary] = useState<MltPrompt[]>([]);
  const [selected, setSelected] = useState<SelectedPrompt[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getMltPrompts();
        setLibrary(res.prompts);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't load prompt library.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isSelected = (libraryId: string) =>
    selected.some((s) => s.libraryId === libraryId);

  const togglePrompt = (prompt: MltPrompt) => {
    setSelected((prev) => {
      const existing = prev.findIndex((s) => s.libraryId === prompt.id);
      if (existing >= 0) {
        return prev.filter((_, i) => i !== existing);
      }
      if (prev.length >= MAX_PROMPTS) return prev;
      return [...prev, { text: prompt.text, libraryId: prompt.id }];
    });
  };

  const removeSelected = (index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  };

  const addCustom = () => {
    const text = customDraft.trim();
    if (!text) return;
    if (text.length > MAX_PROMPT_LENGTH) return;
    if (selected.length >= MAX_PROMPTS) return;
    setSelected((prev) => [...prev, { text, libraryId: null }]);
    setCustomDraft("");
  };

  const pickForMe = () => {
    const shuffled = [...library].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, Math.min(PICK_FOR_ME_COUNT, library.length));
    setSelected(picks.map((p) => ({ text: p.text, libraryId: p.id })));
  };

  const handleContinue = async () => {
    if (selected.length < 3) {
      Alert.alert("Need more prompts", "Pick at least 3 prompts to continue.");
      return;
    }
    setSaving(true);
    try {
      const voterId = await getVoterId();
      await addItems(code, {
        items: selected.map((s) => s.text),
        creatorVoterId: voterId,
      });
      router.replace({ pathname: "/create/share", params: { code } });
    } catch (e) {
      Alert.alert(
        "Couldn't save prompts",
        e instanceof ApiError ? e.message : "Try again."
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Pick your prompts</Text>
        <Text style={styles.subhead}>
          {selected.length} of {MAX_PROMPTS} selected
        </Text>

        {/* Selected row */}
        {selected.length > 0 && (
          <View style={styles.selectedSection}>
            {selected.map((s, i) => (
              <Animated.View
                key={`${s.libraryId ?? "custom"}-${i}-${s.text}`}
                entering={FadeInDown.duration(200)}
                layout={Layout.springify()}
                style={styles.selectedChip}
              >
                <Text style={styles.selectedText} numberOfLines={2}>
                  {s.text}
                </Text>
                <Pressable onPress={() => removeSelected(i)} hitSlop={8}>
                  <Text style={styles.removeX}>×</Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Pick-for-me */}
        <Pressable style={styles.pickForMeBtn} onPress={pickForMe}>
          <Text style={styles.pickForMeText}>Pick {PICK_FOR_ME_COUNT} for me</Text>
        </Pressable>

        {/* Library */}
        <Text style={styles.sectionLabel}>Library</Text>
        {library.map((p) => {
          const sel = isSelected(p.id);
          return (
            <Pressable
              key={p.id}
              onPress={() => togglePrompt(p)}
              style={[styles.libraryCard, sel && styles.libraryCardSelected]}
              disabled={!sel && selected.length >= MAX_PROMPTS}
            >
              <Text style={[styles.libraryText, sel && styles.libraryTextSelected]}>
                {p.text}
              </Text>
              <Text style={styles.libraryAddIcon}>{sel ? "✓" : "+"}</Text>
            </Pressable>
          );
        })}

        {/* Custom input */}
        <Text style={styles.sectionLabel}>Add a custom prompt</Text>
        <View style={styles.customRow}>
          <TextInput
            value={customDraft}
            onChangeText={setCustomDraft}
            placeholder="Most likely to..."
            maxLength={MAX_PROMPT_LENGTH}
            style={styles.customInput}
            onSubmitEditing={addCustom}
            returnKeyType="done"
          />
          <Pressable
            onPress={addCustom}
            style={[
              styles.customAddBtn,
              (!customDraft.trim() || selected.length >= MAX_PROMPTS) && styles.disabled,
            ]}
            disabled={!customDraft.trim() || selected.length >= MAX_PROMPTS}
          >
            <Text style={styles.customAddText}>Add</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Sticky bottom continue */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={[
            styles.continueBtn,
            (selected.length < 3 || saving) && styles.disabled,
          ]}
          disabled={selected.length < 3 || saving}
          onPress={handleContinue}
        >
          <Text style={styles.continueText}>
            {saving ? "Saving..." : `Continue (${selected.length})`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  scrollContent: { padding: spacing.xl, paddingBottom: 120 },
  center: { alignItems: "center", justifyContent: "center" },
  heading: { ...typography.h1, color: colors.charcoal, marginBottom: spacing.xs },
  subhead: { ...typography.body, color: colors.slate, marginBottom: spacing.lg },
  selectedSection: { gap: spacing.sm, marginBottom: spacing.lg },
  selectedChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.coral,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.soft,
  },
  selectedText: { ...typography.body, color: colors.charcoal, flex: 1 },
  removeX: { fontSize: 24, color: colors.slate, paddingLeft: spacing.sm, lineHeight: 24 },
  pickForMeBtn: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.coral,
    marginBottom: spacing.lg,
  },
  pickForMeText: { ...typography.body, color: colors.coral, fontWeight: "600" },
  sectionLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.charcoal,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  libraryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sand,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  libraryCardSelected: {
    backgroundColor: colors.sandLight,
    borderColor: colors.coral,
  },
  libraryText: { ...typography.body, color: colors.charcoal, flex: 1 },
  libraryTextSelected: { color: colors.charcoal, opacity: 0.7 },
  libraryAddIcon: { fontSize: 22, color: colors.coral, paddingLeft: spacing.sm },
  customRow: { flexDirection: "row", gap: spacing.sm },
  customInput: {
    flex: 1,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sand,
    padding: spacing.md,
    ...typography.body,
  },
  customAddBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.coral,
    borderRadius: radius.md,
  },
  customAddText: { ...typography.body, color: "#fff", fontWeight: "600" },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.xl,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.sand,
  },
  continueBtn: {
    backgroundColor: colors.coral,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
  },
  continueText: { ...typography.h3, color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.4 },
  errorText: { ...typography.body, color: colors.slate, textAlign: "center" },
});
```

If `colors.sandLight` or any named token isn't in your theme, substitute the closest existing one — the styles are illustrative, not strict.

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 4: Smoke test in the app**

Run the app, create an mlt room, and confirm:
- Library loads with ~50 prompts
- Tapping a card adds it to the selected row
- Tapping again removes it
- "Pick 7 for me" populates 7 random prompts
- Custom text input adds a custom prompt
- Cap at 15 — further taps don't add
- Continue button disabled below 3 selections
- Tapping Continue navigates to share screen

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/create/mlt-prompts.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): mlt prompt selection screen"
```

---

### Task 11: Update the share screen for mlt gating

**Files:**
- Modify: `apps/mobile/app/create/share.tsx`

- [ ] **Step 1: Read the existing file**

Open `apps/mobile/app/create/share.tsx`. Note where it currently:
- Reads the room state (likely via `getRoom`)
- Polls participant count
- Decides whether to enable the Start button
- Routes after Start succeeds

- [ ] **Step 2: Add mlt-specific gating to the Start button**

Find the logic that determines whether Start is enabled. For mlt, the gate is **≥3 prompts AND ≥3 participants joined**. Other modes' gating stays unchanged.

The participant count likely comes from polling `getParticipants(code)` or a similar API call. If the screen doesn't yet poll participants for non-rank/bracket modes, add a poll for mlt:

```ts
// Inside the share screen component, alongside any existing polling:
const [participantCount, setParticipantCount] = useState(0);
const mode = room?.mode; // assuming room is loaded

useEffect(() => {
  if (mode !== "mlt") return;
  let cancelled = false;
  const tick = async () => {
    try {
      const { participants } = await getParticipants(code);
      if (!cancelled) setParticipantCount(participants.length);
    } catch {
      // ignore; poll will retry
    }
  };
  tick();
  const id = setInterval(tick, 3000);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}, [mode, code]);
```

(Import `getParticipants` from `../../lib/api` and check that it exists — if it doesn't, see the existing waiting screen for how participants are fetched and reuse that pattern.)

Then update the Start button's `disabled` predicate:

```ts
const canStart =
  mode === "mlt"
    ? items.length >= 3 && items.length <= 15 && participantCount >= 3
    : /* existing per-mode logic */;
```

If your file uses a different pattern, adapt to match. The requirement is: for mlt, **both** ≥3 prompts AND ≥3 participants are required.

- [ ] **Step 3: Add a "waiting for participants" hint in mlt mode**

When `mode === 'mlt'` and `participantCount < 3`, render a hint near the Start button:

```tsx
{mode === "mlt" && participantCount < 3 && (
  <Text style={styles.hint}>
    {participantCount} of 3 joined — share the code to fill the room.
  </Text>
)}
```

Add a `hint` style if one doesn't exist:

```ts
hint: { ...typography.body, color: colors.slate, textAlign: "center", marginTop: spacing.sm },
```

- [ ] **Step 4: Route to the mlt play screen on successful start**

Find the `onStart` (or similar) handler. After the API call to `startVoting(...)` (or whichever function calls `POST /api/rooms/:code/start`) resolves, the screen routes to one of the existing play screens (e.g. `/room/[code]/swipe`, `/room/[code]/bracket`).

Add an mlt branch:

```ts
if (room.mode === "mlt") {
  router.replace({ pathname: "/room/[code]/mlt", params: { code, name: creatorName, isCreator: "1" } });
} else if (room.mode === "bracket") {
  // existing bracket route
} else if (room.mode === "rank") {
  // existing rank route
} else {
  // existing swipe route
}
```

Use the exact param shape the existing modes use (look at how the bracket route is constructed in the same file).

- [ ] **Step 5: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/create/share.tsx
git commit -m "feat(mobile): share screen gates mlt start on 3 participants"
```

---

### Task 12: MLT play screen

**Files:**
- Create: `apps/mobile/app/room/[code]/mlt.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Register the new route**

Open `apps/mobile/app/_layout.tsx`. Add a new `<Stack.Screen ... />` for the mlt play screen, modeled on the existing `room/[code]/bracket` registration:

```tsx
<Stack.Screen name="room/[code]/mlt" options={{ title: "Most Likely To", headerShown: false }} />
```

- [ ] **Step 2: Create the play screen**

Create `apps/mobile/app/room/[code]/mlt.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
} from "react-native-reanimated";
import PlayerTile from "../../../components/PlayerTile";
import {
  getRoom,
  getParticipants,
  submitMltVote,
  ApiError,
  type GetRoomResponse,
} from "../../../lib/api";
import { getVoterId } from "../../../lib/storage";
import { getPlayerColor } from "../../../lib/player-colors";
import { colors, spacing, radius, typography } from "../../../lib/theme";

type Participant = { voterId: string; voterName: string; joinedAt: string };

export default function MltPlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, name } = useLocalSearchParams<{ code: string; name?: string }>();

  const [room, setRoom] = useState<GetRoomResponse | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myVoterId, setMyVoterId] = useState<string>("");
  const [myMltVotes, setMyMltVotes] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const voterId = await getVoterId();
        setMyVoterId(voterId);
        const [roomRes, partRes] = await Promise.all([
          getRoom(code, voterId),
          getParticipants(code),
        ]);
        setRoom(roomRes);
        setParticipants(partRes.participants);
        const my = (roomRes as any).myMltVotes ?? {};
        setMyMltVotes(my);
        // Resume: skip past already-voted prompts
        const items = roomRes.items;
        const firstUnvoted = items.findIndex((it) => !my[it.id]);
        setCurrentIndex(firstUnvoted === -1 ? items.length : firstUnvoted);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't load the room.");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  // If the room is already revealed by the time we open the screen, route to results
  useEffect(() => {
    if (room?.status === "revealed") {
      router.replace({ pathname: "/room/[code]/results", params: { code } });
    }
  }, [room?.status, code, router]);

  // If we've voted on every prompt, route to waiting
  useEffect(() => {
    if (!room) return;
    if (currentIndex >= room.items.length) {
      router.replace({ pathname: "/room/[code]/waiting", params: { code, name: name ?? "" } });
    }
  }, [currentIndex, room, code, name, router]);

  const colorByVoterId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getPlayerColor>>();
    participants.forEach((p, i) => map.set(p.voterId, getPlayerColor(i)));
    return map;
  }, [participants]);

  const handleVote = async (targetVoterId: string) => {
    if (!room || submitting) return;
    const item = room.items[currentIndex];
    if (!item) return;
    setSubmitting(true);
    try {
      await submitMltVote(code, {
        itemId: item.id,
        voterId: myVoterId,
        voterName: name ?? "",
        targetVoterId,
      });
      setMyMltVotes((prev) => ({ ...prev, [item.id]: targetVoterId }));
      setCurrentIndex((prev) => prev + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit vote.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (!room || currentIndex >= room.items.length) {
    // Routing handled in effects above
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  const currentItem = room.items[currentIndex];

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.progress}>
          Prompt {currentIndex + 1} of {room.items.length}
        </Text>
      </View>

      <Animated.View
        key={currentItem.id}
        entering={SlideInRight.duration(220)}
        exiting={SlideOutLeft.duration(180)}
        style={styles.promptCard}
      >
        <Text style={styles.promptText}>{currentItem.title}</Text>
      </Animated.View>

      <View style={styles.tileGrid}>
        {participants.map((p) => {
          const color = colorByVoterId.get(p.voterId) ?? getPlayerColor(0);
          const label = p.voterId === myVoterId ? `${p.voterName} (you)` : p.voterName;
          return (
            <View key={p.voterId} style={styles.tileWrapper}>
              <PlayerTile
                name={label}
                color={color}
                onPress={() => handleVote(p.voterId)}
                disabled={submitting}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream, padding: spacing.xl },
  center: { alignItems: "center", justifyContent: "center" },
  header: { marginBottom: spacing.lg, alignItems: "center" },
  progress: { ...typography.body, color: colors.slate },
  promptCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    padding: spacing.xl,
    minHeight: 180,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.xl,
    borderWidth: 2,
    borderColor: colors.sand,
  },
  promptText: {
    ...typography.h2,
    color: colors.charcoal,
    textAlign: "center",
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "center",
  },
  tileWrapper: {
    minWidth: "45%",
    flexBasis: "45%",
    flexGrow: 1,
  },
  errorText: { ...typography.body, color: colors.slate, textAlign: "center" },
});
```

**Notes about imports:**
- `getRoom` and `getParticipants` should exist in `apps/mobile/lib/api.ts` (used by other screens). If `getParticipants` doesn't exist, look at the waiting screen for how it fetches participants and reuse that approach.
- `GetRoomResponse` is the typed response of `getRoom`. If it's named differently in your `api.ts`, adjust the import.
- The `myMltVotes` cast to `any` is because the type may not yet include it — Task 6 added the field as a response shape, but the existing `getRoom` return type may not surface it. If it does, drop the `any` cast.

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 4: Smoke test on simulator**

Create an mlt room with 3 prompts. Join with 2 more clients (use a second simulator and web). Start. Verify:
- Play screen loads with prompt + 3 player tiles
- Tapping a tile advances to the next prompt
- After 3 votes, routes to waiting screen
- Closing the app and reopening resumes at the next unvoted prompt

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/room/[code]/mlt.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): mlt play screen"
```

---

### Task 13: Reveal card component + results screen mlt branch

**Files:**
- Create: `apps/mobile/components/MltRevealCard.tsx`
- Modify: `apps/mobile/app/room/[code]/results.tsx`

- [ ] **Step 1: Create the MltRevealCard component**

Create `apps/mobile/components/MltRevealCard.tsx`:

```tsx
import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from "react-native-reanimated";
import { colors, spacing, radius, typography, shadows } from "../lib/theme";

type Tally = { targetVoterId: string; name: string; count: number };
type Winner = { voterId: string; name: string };

type Props = {
  promptText: string;
  promptIndex: number;
  total: number;
  tallies: Tally[];
  winners: Winner[];
  onNext: () => void;
};

export default function MltRevealCard({
  promptText,
  promptIndex,
  total,
  tallies,
  winners,
  onNext,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const flip = useSharedValue(0);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` }],
    opacity: interpolate(flip.value, [0, 0.5, 0.5], [1, 1, 0]),
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` }],
    opacity: interpolate(flip.value, [0.5, 0.5, 1], [0, 1, 1]),
  }));

  const doReveal = () => {
    setRevealed(true);
    flip.value = withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) });
  };

  // Non-zero tallies first, alphabetical secondary (server already sorts; reuse)
  const winnerNames = winners.map((w) => w.name).join(" & ");
  const winnerCount = winners.length > 0 ? tallies[0].count : 0;
  const runnersUp = tallies.filter((t) => !winners.some((w) => w.voterId === t.targetVoterId));

  return (
    <View style={styles.wrapper}>
      <Text style={styles.progress}>
        Prompt {promptIndex + 1} of {total}
      </Text>

      <Text style={styles.promptText}>{promptText}</Text>

      <Pressable onPress={revealed ? undefined : doReveal} style={styles.cardArea}>
        <Animated.View style={[styles.face, styles.front, frontStyle]}>
          <Text style={styles.coveredLabel}>Tap to reveal</Text>
        </Animated.View>
        <Animated.View style={[styles.face, styles.back, backStyle]}>
          {winners.length === 0 ? (
            <Text style={styles.noVotes}>No votes cast</Text>
          ) : (
            <>
              <Text style={styles.crown}>
                {winners.length > 1 ? "👑 Tied" : "👑"}
              </Text>
              <Text style={styles.winnerName}>{winnerNames}</Text>
              <Text style={styles.winnerVotes}>
                {winnerCount} {winnerCount === 1 ? "vote" : "votes"}
              </Text>
              {runnersUp.length > 0 && (
                <Text style={styles.runners}>
                  {runnersUp.map((t) => `${t.name} ${t.count}`).join(" · ")}
                </Text>
              )}
            </>
          )}
        </Animated.View>
      </Pressable>

      {revealed && (
        <Pressable style={styles.nextBtn} onPress={onNext}>
          <Text style={styles.nextText}>Next →</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { padding: spacing.xl, alignItems: "stretch" },
  progress: { ...typography.body, color: colors.slate, textAlign: "center", marginBottom: spacing.sm },
  promptText: {
    ...typography.h2,
    color: colors.charcoal,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  cardArea: {
    height: 240,
    position: "relative",
  },
  face: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.warmWhite,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.sand,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backfaceVisibility: "hidden",
    ...shadows.soft,
  },
  front: {},
  back: { borderColor: colors.coral },
  coveredLabel: { ...typography.h3, color: colors.slate },
  crown: { fontSize: 30, marginBottom: spacing.xs },
  winnerName: { ...typography.h1, color: colors.charcoal, textAlign: "center" },
  winnerVotes: { ...typography.body, color: colors.slate, marginTop: spacing.xs },
  runners: {
    ...typography.body,
    color: colors.slate,
    marginTop: spacing.md,
    textAlign: "center",
  },
  noVotes: { ...typography.body, color: colors.slate },
  nextBtn: {
    marginTop: spacing.xl,
    alignSelf: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.coral,
    borderRadius: radius.md,
  },
  nextText: { ...typography.h3, color: "#fff", fontWeight: "600" },
});
```

- [ ] **Step 2: Add the mlt branch in `results.tsx`**

Open `apps/mobile/app/room/[code]/results.tsx`. Find the existing dispatch (around lines 50-60) that splits between vote, rank, and bracket results. Add an mlt branch.

Find this block (or similar):

```ts
type RevealedVoteResults = Extract<ResultsResponse, { revealed: true; results: any[] }>;
type RevealedRankResults = Extract<ResultsResponse, { revealed: true; mode: "rank" }>;
type RevealedBracketResults = Extract<ResultsResponse, { revealed: true; mode: "bracket" }>;
```

Add:

```ts
type RevealedMltResults = Extract<ResultsResponse, { revealed: true; mode: "mlt" }>;
```

Find the state hooks block:

```ts
const [voteData, setVoteData] = useState<RevealedVoteResults | null>(null);
const [rankData, setRankData] = useState<RevealedRankResults | null>(null);
const [bracketData, setBracketData] = useState<RevealedBracketResults | null>(null);
```

Add:

```ts
const [mltData, setMltData] = useState<RevealedMltResults | null>(null);
```

Find the dispatch in the load function:

```ts
} else if ("mode" in res && res.mode === "rank") {
  setRankData(res);
} else if ("mode" in res && res.mode === "bracket") {
  setBracketData(res as RevealedBracketResults);
} else {
  setVoteData(res as RevealedVoteResults);
}
```

Add an mlt branch before the final `else`:

```ts
} else if ("mode" in res && res.mode === "rank") {
  setRankData(res);
} else if ("mode" in res && res.mode === "bracket") {
  setBracketData(res as RevealedBracketResults);
} else if ("mode" in res && res.mode === "mlt") {
  setMltData(res as RevealedMltResults);
} else {
  setVoteData(res as RevealedVoteResults);
}
```

- [ ] **Step 3: Render the mlt branch**

In the rendering section of `results.tsx`, find where it conditionally renders by mode (e.g. `if (rankData) return <RankResultsView ... />`). Add a parallel branch for mlt before the existing vote-mode rendering. Add this view component at the bottom of the file:

```tsx
function MltResultsView({
  data,
  onHome,
}: {
  data: RevealedMltResults;
  onHome: () => void;
}) {
  const [phase, setPhase] = useState<"reveal" | "leaderboard">("reveal");
  const [promptIndex, setPromptIndex] = useState(0);

  const handleNext = () => {
    if (promptIndex + 1 < data.prompts.length) {
      setPromptIndex((i) => i + 1);
    } else {
      setPhase("leaderboard");
    }
  };

  const handleReplay = () => {
    setPromptIndex(0);
    setPhase("reveal");
  };

  if (phase === "reveal") {
    const current = data.prompts[promptIndex];
    return (
      <MltRevealCard
        key={current.itemId}
        promptText={current.text}
        promptIndex={promptIndex}
        total={data.prompts.length}
        tallies={current.tallies}
        winners={current.winners}
        onNext={handleNext}
      />
    );
  }

  // Leaderboard phase
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <View style={mltResultsStyles.leaderboardWrap}>
      <Text style={mltResultsStyles.title}>🏆 Superlatives</Text>
      {data.leaderboard.map((entry, i) => (
        <View key={entry.voterId} style={mltResultsStyles.row}>
          <Text style={mltResultsStyles.medal}>{medals[i] ?? "  "}</Text>
          <Text style={mltResultsStyles.name}>{entry.name}</Text>
          <Text style={mltResultsStyles.wins}>
            {entry.wins} {entry.wins === 1 ? "win" : "wins"}
          </Text>
        </View>
      ))}
      <Pressable style={mltResultsStyles.btn} onPress={handleReplay}>
        <Text style={mltResultsStyles.btnText}>Replay reveal</Text>
      </Pressable>
      <Pressable style={[mltResultsStyles.btn, mltResultsStyles.btnSecondary]} onPress={onHome}>
        <Text style={[mltResultsStyles.btnText, mltResultsStyles.btnTextSecondary]}>
          Back to home
        </Text>
      </Pressable>
    </View>
  );
}

const mltResultsStyles = StyleSheet.create({
  leaderboardWrap: { padding: spacing.xl, alignItems: "stretch" },
  title: { ...typography.h1, color: colors.charcoal, textAlign: "center", marginBottom: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.warmWhite,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.sand,
  },
  medal: { ...typography.h2, width: 40 },
  name: { ...typography.h3, flex: 1, color: colors.charcoal },
  wins: { ...typography.body, color: colors.slate },
  btn: {
    marginTop: spacing.lg,
    backgroundColor: colors.coral,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  btnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.coral },
  btnText: { ...typography.h3, color: "#fff", fontWeight: "600" },
  btnTextSecondary: { color: colors.coral },
});
```

Make sure to import `MltRevealCard`, `View`, `Text`, `Pressable`, `useState`, and any used theme tokens at the top of `results.tsx`. The exact placement of imports varies by file; add what's missing.

In the main `ResultsScreen` render, add the mlt branch:

```tsx
if (mltData) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream, paddingTop: insets.top }}>
      <MltResultsView
        data={mltData}
        onHome={async () => {
          await clearActiveRoom();
          router.replace("/");
        }}
      />
    </ScrollView>
  );
}
```

Place this **before** the existing bracket and vote rendering so it takes priority when mlt data is present.

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/MltRevealCard.tsx apps/mobile/app/room/[code]/results.tsx
git commit -m "feat(mobile): mlt reveal card + results screen branch"
```

---

### Task 14: Layout, lobby, waiting, home glue

**Files:**
- Modify: `apps/mobile/app/room/[code]/lobby.tsx`
- Modify: `apps/mobile/app/room/[code]/waiting.tsx`
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Lobby dispatch to mlt screen**

Open `apps/mobile/app/room/[code]/lobby.tsx`. Find the effect that polls room status and dispatches to a play screen when status transitions to `voting`. It probably looks like:

```ts
if (room.status === "voting") {
  if (room.mode === "rank") {
    router.replace({ pathname: "/room/[code]/rank", params: { code, name } });
  } else if (room.mode === "bracket") {
    router.replace({ pathname: "/room/[code]/bracket", params: { code, name } });
  } else {
    router.replace({ pathname: "/room/[code]/swipe", params: { code, name } });
  }
}
```

Add an mlt branch:

```ts
if (room.status === "voting") {
  if (room.mode === "rank") {
    router.replace({ pathname: "/room/[code]/rank", params: { code, name } });
  } else if (room.mode === "bracket") {
    router.replace({ pathname: "/room/[code]/bracket", params: { code, name } });
  } else if (room.mode === "mlt") {
    router.replace({ pathname: "/room/[code]/mlt", params: { code, name } });
  } else {
    router.replace({ pathname: "/room/[code]/swipe", params: { code, name } });
  }
}
```

- [ ] **Step 2: Waiting screen — handle mlt status & reveal**

Open `apps/mobile/app/room/[code]/waiting.tsx`. Most of the existing logic likely already works because `/api/rooms/:code/status` returns `{ completedCount, totalVoters, isRevealed }` regardless of mode. But:
- The "in progress" label may be mode-specific. If it currently says "Voting..." for vote mode and "Ranking..." for rank, add an mlt case.
- The reveal-dispatch effect (when `isRevealed` becomes true, route to `/results`) should already work as-is — `results.tsx` now handles mlt.

Find the label rendering (look for strings like "Ranking" or "Voting on matchups"). Add an mlt case:

```ts
const progressLabel =
  mode === "rank"
    ? "Ranking..."
    : mode === "bracket"
      ? "Voting on matchups..."
      : mode === "mlt"
        ? "Voting on prompts..."
        : "Voting...";
```

If the existing file doesn't pull `mode` from props/params, add it: it's available via `useLocalSearchParams` or by fetching the room.

- [ ] **Step 3: Home screen — rejoin honors mlt**

Open `apps/mobile/app/index.tsx`. Find the "active room rejoin" logic that reads the saved room from storage and routes the user back into it. It likely branches on mode to pick the correct screen.

Add an mlt branch wherever the existing modes are handled. The pattern mirrors the lobby dispatch from Step 1.

For example, find:

```ts
const target =
  saved.status === "voting" && saved.mode === "rank"
    ? "/room/[code]/rank"
    : /* ... */;
```

Add an mlt case:

```ts
saved.mode === "mlt"
  ? "/room/[code]/mlt"
  : /* ... */
```

Apply the same pattern wherever the home screen's rejoin logic picks a destination based on mode (lobby, voting, revealed).

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/room/[code]/lobby.tsx apps/mobile/app/room/[code]/waiting.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): wire mlt into lobby, waiting, and rejoin"
```

---

## Phase C — End-to-end test

### Task 15: End-to-end manual test

**Files:** none (manual test).

- [ ] **Step 1: Start the API**

```bash
cd apps/api && npx wrangler dev
```

Leave it running.

- [ ] **Step 2: Start the mobile app**

In another terminal:

```bash
cd apps/mobile && npx expo start
```

Open the app on an iOS simulator, Android emulator, and the web client (press `w` in the Expo CLI). You need 3 distinct clients to exercise the 3-participant minimum.

- [ ] **Step 3: Run the full flow**

On client 1 (host):
1. Home → Create a room
2. Tap **Most Likely To**
3. Enter a topic (e.g. "Friends night") and your name → Continue
4. On the prompt-selection screen, tap "Pick 7 for me" → tap a couple custom additions → Continue
5. On the share screen, note the room code

On clients 2 and 3 (participants):
1. Home → Join a room
2. Enter the code and a name → Lobby

Back on client 1:
1. Confirm the share screen shows "3 of 3 joined" (or similar)
2. Tap **Start**

All three clients should land on the MLT play screen:
- Verify the prompt text renders correctly
- Verify all 3 player tiles are visible and color-distinct
- Tap a player tile — the prompt card should slide off, next prompt appears
- After voting on all prompts, lands on the waiting screen

After all 3 finish:
- All clients should transition to the results screen
- Tap to reveal each prompt — flip animation fires, winner + tally shown
- After last prompt, leaderboard renders with medals
- "Replay reveal" returns to prompt 1
- "Back to home" clears the active room

- [ ] **Step 4: Sanity-check resume**

On client 2, force-close the app mid-vote (e.g. after 2 of 7 prompts). Reopen.
- Should land back on the MLT play screen at prompt 3 (the first un-voted prompt).

- [ ] **Step 5: Sanity-check the minimum-participants gate**

Create a fresh mlt room. Add prompts but **do not** join with extra participants. Try to tap Start.
- Start button should be disabled or, if tapped, the API should reject with "need at least 3 participants."

- [ ] **Step 6: Tag the milestone (optional)**

If everything works, optionally tag the commit:

```bash
git tag mlt-mode-shipped
```

Or just leave the history as commits — the project doesn't have an existing tagging convention.

- [ ] **Step 7: Update CLAUDE.md (optional)**

If desired, update the project structure section and game-mode list in `CLAUDE.md` to mention Most Likely To. This is not strictly required — the existing CLAUDE.md describes the architecture pattern that mlt follows.
