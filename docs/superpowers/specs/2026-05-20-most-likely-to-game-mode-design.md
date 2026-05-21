# Most Likely To Game Mode — Design

**Date:** 2026-05-20
**Status:** Approved (design phase)

## Summary

Add a fourth game mode to This or That, called **Most Likely To**, alongside Swipe Vote, Blind Rank, and Bracket. Where the existing modes ask "which item does the group like best?", Most Likely To inverts the subject: items become *prompts* (e.g., "...ghost the group chat for 3 days"), and players vote on which *person in the room* fits each prompt. The output isn't a winning item — it's a profile of the group, plus a "Superlatives" leaderboard ranking players by how many prompts they won. The host seeds prompts from a curated library (with optional custom additions). Voting is asynchronous — everyone votes on every prompt independently — and the results screen reveals prompt winners one at a time with a tap-to-flip animation, ending on the leaderboard.

## Goals

- Ship a fourth game mode that is structurally distinct from the existing three (different vote subject, different output shape) rather than a mechanical variant.
- Reuse the existing room lifecycle (create → set up → start → play → reveal) and per-mode dispatch pattern established by Blind Rank and Bracket.
- Keep voting asynchronous (like Swipe Vote) so no sync pressure on participants, but make the reveal experience dramatic (per-prompt flip animation, leaderboard finale).
- Lower the host's creative burden via a curated prompt library while keeping custom prompts available for inside-joke tailoring.
- Keep Swipe Vote, Blind Rank, and Bracket behaviorally unchanged.

## Non-goals

- Per-round synchronized voting and reveals (that's Bracket's pattern; Most Likely To is asynchronous start-to-finish).
- Player avatars / photos (no auth, no upload story). Players are identified by name + color.
- Vote attribution ("Mike voted for Sarah"). Tallies are anonymous in v1.
- Skipping or no-opinion votes. Every voter votes on every prompt to be marked complete.
- Per-prompt difficulty / weighting. Every prompt counts equally toward leaderboard wins.
- Prompt packs / tag-based filtering UI. The curated library is a flat list in v1 (the `tags` field is added forward-looking but unused).
- Auto-prefixing custom prompts with "Most likely to…". Hosts write the full text verbatim to allow non-conforming phrasings.
- A new round / reveal-sync server endpoint. The reveal is pure client-side state.
- Auth-gated history or saved superlatives. Same anonymous model as other modes.

## User flow

### Creator
1. Home → tap **Create a Room**.
2. **Mode picker screen** — fourth card added: "Most Likely To."
3. **Topic + name screen** — existing. Topic optional (e.g. "Friends roast night"). There is no `expectedCount` in the current data model (it was removed in migration 0002 in favor of using the live `participants` count). "Allow suggestions" toggle is hidden in MLT mode (prompts come from the library/host, not participants — keeps the host in control of tone).
4. **Prompt selection screen** (new) — covered under [Screens](#screens). Host browses curated library, taps to add prompts, optionally types custom ones, max 15 total.
5. **Share screen** — existing. Shows the room code and a "3 of N joined — waiting for 2 more" hint when fewer than 3 participants are in the room. Start button stays disabled until **at least 3 participants have joined AND at least 3 prompts have been added**.
6. Tap **Start** — server validates `participants count >= 3` and `3 <= item count <= 15` for MLT mode; transitions room to `voting`.
7. **MLT play screen** (new) — creator votes on prompts like everyone else.
8. **Waiting screen** — existing; "X of N done."
9. **Results screen — Phase 1 (Per-prompt reveal)** — taps through prompt cards, each flipping to reveal the top vote-getter and the tally spread.
10. **Results screen — Phase 2 (Superlatives leaderboard)** — final tap shows the leaderboard ranked by wins.

### Participant
1. Home → **Join a Room** → enter code → enter name (all existing).
2. **Lobby** — existing "waiting for host to start." In MLT mode, prompts are never shown here.
3. **MLT play screen** → same as creator from step 7 onward.

### Routing dispatch
`app/room/[code]/_layout.tsx` already dispatches by mode for Swipe vs. Rank vs. Bracket. Extend it to also route MLT rooms to the new `mlt.tsx` screen.

## Screens

### Mode picker (updated)

Fourth card added below the existing three:
- **Most Likely To** — "Pick prompts like 'most likely to ghost the group chat.' For each prompt, everyone votes on which player in the room fits it best."

With four cards, the screen stays single-column scrollable. Revisit as a 2×2 grid only if a fifth mode lands.

### Prompt selection screen (new)

The MLT creation flow replaces the standard "add items" screen with a prompt selection screen, because the affordance is "browse + tap to add," not "type cold."

Layout (top to bottom):
- **Header**: "Pick your prompts" + counter ("3 of 15").
- **Selected prompts row** (collapsed when empty, expands as prompts are added): horizontally scrollable chips showing each selected prompt's text (truncated) with a small "×" to remove. Reorderable via long-press drag (matches existing items screen pattern; if drag-reorder isn't already wired in for items, defer to v1.1).
- **"Pick 7 for me" button**: randomly seeds 7 prompts from the library, replacing any currently selected. One-tap quick start.
- **Library list**: scrollable list of curated prompt cards. Each card shows the prompt text and a "+" button (or whole card is tappable). Tapping adds it to the selected row; already-selected cards show "✓ Added" and are visually de-emphasized but still tappable to remove.
- **Add custom prompt input**: textbox at the bottom (or floating action button to expand). Max 80 chars. "Add" button appends to the selected row.

Interaction:
- Tapping a library card adds the prompt to the selected row with a small slide animation.
- Tapping an already-added card removes it.
- Custom prompts and library prompts are visually distinguished in the selected row (small icon or color tint) so the host can tell at a glance.
- Start button (sticky bottom or in header) enabled at ≥3 prompts; disabled at 15.

Editing post-start: not allowed (matches Bracket — items lock at start).

### MLT play screen (new)

Layout (top to bottom):
- **Header**: room topic + progress chip ("Prompt 3 of 7").
- **Prompt card**: large text, centered, "Most likely to…" prefix is part of the prompt text for library prompts and is rendered verbatim for custom prompts (no auto-prefix).
- **Player tile grid**: 2-column grid for ≤5 players, 3-column for 6+ players. Each tile shows the player's name on a tinted background using their assigned color. Pressable with scale-down feedback on touch.

Interaction:
- Tap a tile → tile pulses (`withSpring`), tile briefly highlights with its full color, then the prompt card slides off-screen left and the next prompt card animates in from the right.
- Vote saves immediately (one API call per tap), like Swipe Vote.
- The selected tile stays highlighted for ~300ms before the card transition runs, providing a moment of feedback.
- Tap is the only interaction. No swipe, no drag.
- No back / re-vote within a session — once tapped, the vote is locked (consistent with Swipe Vote's "can't un-swipe" model).
- After the last prompt, screen navigates to the waiting screen.

Resume after close:
- Reopening mid-game: play screen fetches `GET /api/rooms/:code` with `voterId`, finds prompts the voter hasn't yet voted on via the returned `myVotes` map, and shows the next unvoted prompt.
- If the voter has voted on all prompts but the room hasn't yet revealed (others still voting), routes directly to the waiting screen.
- If the room has already revealed by the time they open the app, routes to results.

Player color assignment:
- Each player gets one of 8 preset colors derived client-side from their index in the participants list (sorted by `joined_at ASC`). Creator gets index 0.
- The existing `GET /api/rooms/:code/participants` endpoint already orders by `joined_at ASC` (verified in `apps/api/src/routes/rooms.ts:407`), so color stability is already guaranteed — no API change needed.
- Note: `GET /api/rooms/:code` does NOT bundle participants in its payload (verified — only items, status, mode, etc.). The MLT play screen must fetch participants from the separate `/participants` endpoint, or via a new combined endpoint. Recommended path: hit both endpoints on play-screen load (matches whatever pattern the rank/bracket screens currently use — confirm during implementation).
- 8 colors handles realistic group sizes. Beyond 8 players, color reuse is acceptable (rare in practice).

### Results screen (updated for MLT)

The existing `results.tsx` already dispatches by mode (vote / rank / bracket). Add an `mlt` branch.

**Phase 1 — Per-prompt reveal (tap to advance)**

Layout per prompt:
- Header: "Prompt X of N"
- Prompt text (full)
- Hidden tally area: shows a covered card with "Tap to reveal" prompt.
- On tap: card flips (Reanimated rotation, ~400ms) revealing:
  - Winner section: "👑 [Player Name]" large, "[N] votes" smaller. For ties: "👑 Tied" header with all tied player names listed side-by-side.
  - Runner-up row: comma-separated list of remaining players with their vote counts ("Mike 1 · Tom 0 · You 0"). Players with 0 votes still listed for completeness.
- "Next →" button below the revealed card.

Tapping "Next →" loads the next prompt's covered card. The flip state is local; navigating away and back resets to prompt 1.

**Phase 2 — Superlatives leaderboard**

After the final prompt's "Next →":
- Header: "🏆 Superlatives"
- Ranked list of players by `wins` count, descending. Each row: medal (🥇🥈🥉 for top 3, then no medal), name, "N wins".
- Ties in the ranking share a position (two players at 4 wins both render with 🥇).
- Action buttons below:
  - **Replay reveal**: resets local state to prompt 1, Phase 1.
  - **Back to home**: existing pattern, clears active room from storage.

No per-result data fetch between prompts — the full results payload is loaded once on entering the results screen, and all flip/leaderboard rendering is pure client state.

## Data model

One new migration: `0007_mlt_mode.sql`.

### Reuse existing tables

- `rooms.mode = 'mlt'` (new value alongside `'vote'`, `'rank'`, `'bracket'`).
- `items` table reused as-is. `title` holds the prompt text. `sort_order` is the prompt's order in the host's selection. `presentation_order` (already exists, used for participant-specific shuffling in other modes) can be reused, but **MLT doesn't shuffle prompt order** — every voter sees prompts in the same order, because the social context of seeing "what prompt is next" is consistent and there's no anti-position-bias concern (people aren't items).
- `participants` table reused as-is. Player colors derived client-side; no `color_index` column needed.

### New table: `mlt_votes`

```sql
CREATE TABLE mlt_votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),       -- the prompt being voted on
  voter_id TEXT NOT NULL,                            -- who is voting
  voter_name TEXT NOT NULL,                          -- denormalized snapshot
  target_voter_id TEXT NOT NULL,                     -- which player they picked
  target_voter_name TEXT NOT NULL,                   -- denormalized snapshot
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)                          -- one vote per voter per prompt
);

CREATE INDEX idx_mlt_votes_room ON mlt_votes(room_id);
CREATE INDEX idx_mlt_votes_item ON mlt_votes(item_id);
CREATE INDEX idx_mlt_votes_room_voter ON mlt_votes(room_id, voter_id);
```

Denormalizing both `voter_name` and `target_voter_name` matches the precedent set by `votes`, `rankings`, and `matchup_votes`. It survives mid-game renames and avoids a join on reveal.

### Curated prompt library

Static TypeScript array in `apps/api/src/lib/mlt-prompts.ts`:

```ts
export type MltPrompt = { id: string; text: string; tags?: string[] };
export const MLT_PROMPTS: MltPrompt[] = [
  { id: "ghost-group-chat", text: "Most likely to ghost the group chat for 3 days" },
  // ~50 prompts total
];
```

Bundled with the worker. Served via a new endpoint (see [API](#api)) so the library can grow without an app rebuild.

**Content scope for v1:**
- Broad, friend-group-friendly prompts.
- **No prompts about appearance, money, relationships, or sensitive topics.** Drama lives in the *voting*, not the prompts.
- Initial set hand-written by the project owner.

## API

### New endpoints

**`GET /api/mlt/prompts`**
Returns the curated library.
- Response: `{ prompts: [{ id, text, tags? }] }`
- No auth, no caching headers tuning in v1 (revisit if traffic grows).

**`POST /api/rooms/:code/mlt-votes`**
Cast or update a vote for a prompt.
- Body: `{ itemId: string, voterId: string, voterName: string, targetVoterId: string }`
- Server validates:
  - Room exists, not expired, `mode === 'mlt'`, `status === 'voting'`.
  - `voterId` is a participant of the room.
  - `targetVoterId` is also a participant of the room.
  - `itemId` belongs to the room.
- Upserts the row (one vote per `(item_id, voter_id)`).
- Looks up `target_voter_name` from the participants table at insert time.
- After insert, runs the standard reveal-trigger check: if every participant has `mlt_votes` count equal to the room's item count, set `rooms.status = 'revealed'`.
- Returns `{ success: true, progress: { voted, total } }` matching the `votes` endpoint shape.

### Updated existing endpoints

**`POST /api/rooms`**
- Body adds `mode: 'mlt'` (existing field, new accepted value). No `expectedCount` exists in the current model — none is needed for MLT either. Participation minimums are enforced at start time instead.

**`POST /api/rooms/:code/items`**
- Reused for both library-chosen and custom prompts. The client sends the resolved text in either case; the server doesn't care about library origin. (Optional future enhancement: store library prompt IDs to enable analytics on which prompts get picked. Out of scope for v1.)
- Validation: when room `mode === 'mlt'`, max 15 prompts, each `title` ≤ 80 chars.

**`DELETE /api/rooms/:code/items/:itemId`**
- Reused as-is for removing prompts pre-start.

**`POST /api/rooms/:code/start`**
- Reused. Validation: when `mode === 'mlt'`, require `3 <= itemCount <= 15` **AND** `participants count >= 3`. Locks prompts and transitions to `voting`. Returns an explicit error if fewer than 3 participants have joined.

**`GET /api/rooms/:code`**
- Returns `mode: 'mlt'`. When `voterId` is provided, adds a new optional field `myMltVotes: { [itemId]: targetVoterId }` to the response (parallels how rank mode adds `myRankings` on top of `myVotes` — see `rooms.ts:339-354`). The base `myVotes` field stays as `{ [itemId]: 'yes'|'no' }` and is empty for MLT rooms.
- Does **not** bundle participants in its response. The MLT play screen fetches the existing `GET /api/rooms/:code/participants` endpoint separately.

**`GET /api/rooms/:code/status`**
- For `mlt`, a voter is "complete" when their `mlt_votes` count for the room equals the item count. `completedCount` and reveal trigger work identically to other modes.

**`GET /api/rooms/:code/results`**
- When `revealed` and `mode === 'mlt'`, returns:

```ts
{
  revealed: true,
  mode: 'mlt',
  prompts: [
    {
      itemId: string,
      text: string,
      sortOrder: number,
      tallies: [
        { targetVoterId: string, name: string, count: number },
        // ...all participants, ordered by count desc, then by name asc
      ],
      winners: [
        { voterId: string, name: string },
        // 1 entry normally, multiple on tie
      ],
      totalVotes: number  // sanity-check field
    }
  ],
  leaderboard: [
    { voterId: string, name: string, wins: number },
    // ordered by wins desc, then name asc
  ]
}
```

- A "win" = being a (sole or tied) top vote-getter on a prompt. Tied players each get +1 win.
- All prompts included in returned order (`sort_order ASC`).

## Edge cases

### Late joiners after voting starts
- Mirror existing modes: if room is `voting` and the joiner isn't already a participant, they're added and can vote on all prompts.
- They appear as a tile option for **subsequent** prompts (any prompt a voter is about to see for the first time). They do NOT retroactively appear as a tile option for prompts that other voters have already voted on — those votes are immutable.
- Consequence: a late joiner can never receive a vote on a prompt that was already voted on by everyone before they joined. Acceptable for v1; forcing re-votes would be worse UX.
- Reveal still triggers based on currently-joined participants (matches the playtest fix for idle joiners).
- Client implementation note: the tile grid for a given prompt should be derived from the participants list **at vote time**, not the live participants list. Easiest path: when the play screen loads, it captures the participant snapshot for the session. New joiners surface only after a refetch / new prompt navigation.

### Ties on a prompt
- Multiple players tied for top vote count: all rendered as joint winners with a "👑 Tied" header in the reveal animation.
- All tied players get +1 win on the leaderboard.

### Self-votes
- Allowed. Counted normally toward tallies and wins.
- Your tile looks identical to others; no special "self" affordance.

### Zero-vote prompts (theoretical)
- Unreachable under normal flow (every voter must vote on every prompt to complete).
- Defensive UI: if a prompt has 0 votes (e.g., manual DB tampering), the reveal shows "No votes cast" and skips the win attribution.

### Custom prompts
- Max 80 characters, server-validated.
- No auto-prefix — written and displayed verbatim.
- Library prompts include "Most likely to…" in their `text` field; custom ones may or may not, at the host's discretion.

### Player color stability
- Derived client-side from `participants` order by `joined_at ASC`.
- Risk: non-deterministic ordering would shift colors mid-game on refetch. Mitigation: the API explicitly orders participants by `joined_at ASC`.

### Room expiration & cleanup
- 48h expiration applies same as other modes.
- `mlt_votes` rows must be deleted when their room is deleted. Pattern depends on existing project convention — either add `ON DELETE CASCADE` to the foreign keys (preferred if SQLite enforces them with `PRAGMA foreign_keys = ON`) or extend the existing cleanup job. Resolve during implementation by checking how `votes`, `rankings`, and `matchup_votes` are cleaned up.

### Library content updates
- The `/api/mlt/prompts` endpoint allows the library to grow without an app rebuild. No versioning / cache-busting in v1 — the worker serves the current bundled list.

## Project structure additions

```
apps/api/src/
  routes/
    mlt.ts                  ← POST /rooms/:code/mlt-votes, GET /mlt/prompts
  lib/
    mlt-prompts.ts          ← curated library array
  db/
    queries.ts              ← mlt-vote helpers (insertMltVote, getMltVotesForRoom, etc.)
apps/api/migrations/
  0007_mlt_mode.sql         ← mlt_votes table + indexes

apps/mobile/app/
  create/
    mode.tsx                ← add 4th card
    prompts.tsx             ← new prompt selection screen (or mlt-specific extension of items screen — implementation choice)
  room/[code]/
    mlt.tsx                 ← new play screen
    _layout.tsx             ← extend mode dispatch
    results.tsx             ← add mlt branch
apps/mobile/components/
  PlayerTile.tsx            ← tappable player tile (used in mlt.tsx)
  MltRevealCard.tsx         ← flip-to-reveal card (used in results.tsx)
apps/mobile/lib/
  api.ts                    ← getMltPrompts(), submitMltVote() helpers
  player-colors.ts          ← 8-color palette + index assignment
```

## Build sequence

1. Migration `0007_mlt_mode.sql` + curated prompt library file.
2. API: `GET /api/mlt/prompts`, then `POST /api/rooms/:code/mlt-votes`, then results-payload branch.
3. API: validate existing endpoints (`POST /rooms`, `POST /items`, `start`, `GET /rooms/:code`, `status`, `results`) handle `mode === 'mlt'` correctly. Add tests.
4. Mobile: mode picker → add 4th card.
5. Mobile: prompt selection screen (curation flow).
6. Mobile: MLT play screen + player color util.
7. Mobile: results screen MLT branch (flip animation + leaderboard).
8. End-to-end test: create → seed prompts → start → multi-device vote → reveal.
9. Polish: animations, loading states, error handling.
