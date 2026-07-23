# Tier List Game Mode — Design

**Date:** 2026-07-22
**Status:** Approved (design phase)

## Summary

Add a game mode to This or That, called **Tier List**, alongside the existing Swipe Vote, Blind Rank, Bracket, and Most Likely To modes. The host picks a topic and adds 3–12 items. Each player (host included) independently drags **all** the items into an **S / A / B / C / D** board — they see the item pool but not any other player's placements. When every participant has locked in their board, each item's tier is averaged across players into a single **Consensus** board. The reveal screen lets players swipe between the Consensus board and each individual player's board. No scoring or "correct" answer; the reveal is for comparison and discussion.

## Goals

- Ship a fifth game mode that reuses the existing room lifecycle (create → add items → start → play → reveal) and the established per-mode dispatch pattern.
- Give players the classic "tier-list-maker" feel: arrange a whole board, then commit.
- Keep the existing modes behaviorally unchanged.

## Non-goals

- Custom, renamed, or a variable number of tiers (S/A/B/C/D is fixed at five).
- Participant item suggestions in tier mode (suggestions are forced off, as in rank).
- Per-item vote-spread popups on the Consensus board (per-player boards already surface who placed what).
- Scoring, leaderboards, weighting, or confidence.
- A general-purpose "game engine" abstraction. Add the concrete mode; refactor later.

## User flow

### Creator
1. Home → tap **Create a Room**.
2. **Mode picker screen** — add a new **Tier List** card alongside the existing four. Tap it.
3. **Topic + name screen** (`create/index.tsx`) — existing. In tier mode the "allow suggestions" toggle is hidden (suggestions are off, matching rank).
4. **Share screen** (`create/share.tsx`) — existing; this screen holds the item list, the `maxItems` cap, and the `canStart` gate, and is where the creator adds/edits items and taps Start. Tier mode caps the total at **12** items and enables **Start** only once at least **3** items exist.
5. Tap **Start** — server locks items and transitions the room to `voting`.
6. **Tier play screen (new)** — creator builds their own board, same as participants.
7. **Waiting screen** — existing; "X of N done."
8. **Reveal screen** — Consensus board plus per-player boards.

`share.tsx` already branches on `mode` in several places (the `mode` state union, the `maxItems`/`canStart` values, the pre-start alert copy, the post-start navigation target, and the Start button label); each gains a `tier` branch.

### Participant
1. Home → **Join a Room** → enter code → enter name (all existing).
2. **Lobby** — existing "waiting for host to start." No item view needed here for tier mode.
3. **Tier play screen (new).**
4. **Waiting + Reveal** — same as creator.

### Routing dispatch
The mode→screen dispatch is the existing literal chain in `lobby.tsx` (`room.mode === "rank" ? … : "swipe"`), mirrored in `waiting.tsx` and the rejoin path. Add a `mode === "tier" → /room/[code]/tier` branch to each. The existing screens do not otherwise learn about tier mode.

## Screens

### Mode picker (edit)

Add a fifth card to `create/mode.tsx`:
- **Tier List** — "Add items, then everyone drags them into S/A/B/C/D. We average the tiers into one shared board." Routes to `/create` with `params: { mode: "tier" }`. Give it its own accent border color from the theme, consistent with the other mode cards.

### Tier play screen (new — `tier.tsx`)

Layout (top to bottom):
- Header: room topic + progress ("3 of 8 placed").
- Five stacked, color-coded tier rows labeled **S / A / B / C / D**. Each row is a horizontal drop area that can hold any number of item chips.
- A horizontal **pool** of unplaced item chips below the board. Pool order is shuffled per-player using the voter ID as a seed (reusing `lib/shuffle.ts`) to reduce anchoring.

Interaction:
- **Drag** a chip from the pool into a tier row, or from one tier to another. Rows highlight on drag-over. No per-tier limit; multiple items can share a tier.
- **Tap fallback** (Blind Rank flagged drag as rough on Expo web): tap a chip to select it (it highlights), then tap a tier row to place it there. Fully usable without dragging, on every platform.
- Drag implemented with `react-native-gesture-handler` Pan + `react-native-reanimated` shared values, matching the swipe/rank modes. Desktop caps content width and centers.

Commit model (**arrange-then-lock-in**):
- The board is freely rearrangeable client-side; nothing is sent to the server per move.
- A **"Lock in my board"** button is enabled only once all items are placed (pool empty). On tap, the client POSTs the whole board at once, the player is marked complete, and they navigate to the waiting screen.
- Rationale for diverging from the app's usual "save each action immediately": averaging must run on finalized boards, and free rearrangement is the core of the tier-list interaction. A clear single commit also gives an unambiguous "player is done" signal.
- The in-progress board is persisted to AsyncStorage on each move (keyed by room code + voter ID), so closing and reopening the app before lock-in restores the arrangement. The server holds no partial state.

### Reveal screen (edit — tier branch in `results.tsx`)

- A segmented switcher at the top: **[ Consensus ] [ You ] [ Sam ] [ Mia ] …**, swipeable between views.
- Each view renders the same `TierBoard` component (S/A/B/C/D rows with item chips):
  - **Consensus** shows the averaged placement of every item.
  - Each **player** view shows that player's locked-in board.
- "You" is pinned first after Consensus. The host shows the compact host badge, consistent with existing host badge usage.

### Waiting screen (existing, minor update)

Works for both the new and old modes. The only change is the per-voter in-progress status label: for tier rooms it reads **"Sorting…"** (as rank added "Ranking…"). The waiting screen reads the room's `mode` and switches the label accordingly.

## Averaging

- Tier → numeric value: **S = 5, A = 4, B = 3, C = 2, D = 1**.
- For each item, average the numeric values across all locked-in players.
- Round the average to the nearest tier. An exact `.5` rounds **up toward S** (e.g. 3.5 → A). Map the rounded value back to a tier (5 → S … 1 → D).
- Within a tier, items are sorted by exact average descending; ties broken by the item's original `sort_order` for stability.
- The Consensus board is computed server-side in the results endpoint so every client renders the same thing.

## Data model

New migration `apps/api/migrations/0008_tier_list_mode.sql`. No changes to `rooms` or `items` — the `mode` column already exists and defaults to `'vote'`; allowed values gain `'tier'`.

```sql
CREATE TABLE tier_placements (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('S','A','B','C','D')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)     -- one placement per player per item
);

CREATE INDEX idx_tier_placements_room ON tier_placements(room_id);
CREATE INDEX idx_tier_placements_room_voter ON tier_placements(room_id, voter_id);
```

The same `CREATE TABLE`/index statements are also added to `apps/api/src/db/schema.sql`, the canonical full-schema reference copy (as prior mode migrations did). The `votes`, `rankings`, `matchups`/`matchup_votes`, and `mlt_votes` tables are untouched. Tier rooms use `tier_placements` exclusively. Nothing polymorphic.

## API

### Existing endpoints (small additions)

- **`POST /api/rooms`** — accepts `mode: 'tier'` (in addition to the existing values). For tier mode, server forces `allow_suggestions = false`.
- **`POST /api/rooms/:code/items`** — for tier rooms, total item count capped at 12 (instead of 15). Suggestions stay disabled.
- **`POST /api/rooms/:code/start`** — for tier rooms, validates 3–12 items, then transitions to `voting`. No presentation order is stored (the pool shuffle is client-side, per-player).
- **`GET /api/rooms/:code`** — response includes `mode`. For tier rooms the items array **is returned** (the player needs the full pool to build a board — unlike rank, which omits items). Includes `myTiers: { itemId: tier }` when `voterId` is provided, so a locked-in board repaints on resume.
- **`GET /api/rooms/:code/status`** — for tier rooms, a participant is "complete" when they have a placement for every item in the room (i.e., they have locked in). Response shape unchanged; the in-progress label is "Sorting…".

### New endpoint (tier submit, in `apps/api/src/routes/tiers.ts`)

- **`POST /api/rooms/:code/tiers`** — body `{ voterId, voterName, placements: [{ itemId, tier }] }`. Validates: room is tier mode and `voting`; every item in the room appears exactly once; each `tier` is one of S/A/B/C/D. Inserts all placements in a batch. The `UNIQUE(item_id, voter_id)` constraint catches a double lock-in. Returns `{ success: true, progress: { placed, total }, isRevealed }`.

### Tier results/status (mode dispatch in `apps/api/src/routes/results.ts`)

`results.ts` already owns both `/:code/status` and `/:code/results` and branches on `room.mode` (rank/bracket/mlt each have a branch). Add a `tier` branch to each; heavy lifting (consensus computation) lives in `queries.ts`.

- **`GET /api/rooms/:code/status`** (tier branch) — a participant is "complete" when they have a placement for every item; response shape unchanged.
- **`GET /api/rooms/:code/results`** (tier branch) — returns:
  ```json
  {
    "revealed": true,
    "mode": "tier",
    "topic": "...",
    "consensus": [
      { "tier": "S", "items": [{ "itemId": "...", "title": "...", "average": 4.75 }] }
    ],
    "players": [
      { "voterId": "...", "name": "...", "isCreator": false,
        "placements": [{ "itemId": "...", "title": "...", "tier": "A" }] }
    ]
  }
  ```
  Players are sorted with the requesting voter first when `voterId` is provided. If not yet revealed, returns the same `{ revealed: false, completedCount, totalVoters }` shape used by the other modes.
- **Reveal trigger** — the existing creator-only reveal endpoint transitions a `voting` room to `revealed`, used by all modes unchanged. Auto-reveal (below) is the primary path.

### Mode-mismatch errors

- `POST /api/rooms/:code/votes`, `/rankings`, `/bracket` submit endpoints, and `/mlt` submit endpoints on a tier room → 400 "wrong mode."
- `POST /api/rooms/:code/tiers` on a non-tier room → 400 "wrong mode."
- Enabling `allowSuggestions` on a tier room via `PATCH /settings` → 400.

## Auto-reveal trigger

When a player locks in, the server checks: if participants ≥ 2 and every participant has a full set of placements, the room transitions `voting → revealed` (matching the rank mode threshold). The waiting screen polls `/status` and navigates to results when `isRevealed` becomes true.

## Behavior notes

- **Resume after close:** post-lock-in, the client repaints from `myTiers` on `GET /api/rooms/:code`. Pre-lock-in, the client restores the local AsyncStorage draft. The server has no partial-board state.
- **Late joiners:** allowed after start (matches existing behavior). They build a board and the reveal waits for them to lock in.
- **Allow suggestions in tier mode:** forced off at room creation; `PATCH /settings` rejects attempts to enable it.

## File layout

```
apps/api/
├── migrations/
│   └── 0008_tier_list_mode.sql          (new)
├── src/
│   ├── index.ts                          (mount tiers router)
│   ├── routes/
│   │   ├── rooms.ts                      (mode field, item cap 12, start validation 3–12, GET includes items + myTiers)
│   │   ├── votes.ts                      (reject if mode='tier')
│   │   ├── rankings.ts / bracket.ts / mlt.ts   (reject tier where relevant)
│   │   ├── tiers.ts                      (new — POST /tiers submit board only)
│   │   └── results.ts                    (add tier branch to /status + /results)
│   └── db/
│       └── queries.ts                    (tier placement + consensus query helpers)

apps/mobile/
├── app/
│   ├── create/
│   │   ├── mode.tsx                      (new Tier List card)
│   │   ├── index.tsx                     (accept mode='tier'; hide suggestions)
│   │   └── share.tsx                     (tier branch: maxItems=12, canStart 3–12, nav + button label)
│   └── room/[code]/
│       ├── lobby.tsx                     (dispatch branch → tier)
│       ├── waiting.tsx                   (dispatch branch → tier; "Sorting…" label)
│       ├── tier.tsx                      (new — drag/tap board play screen + lock-in)
│       └── results.tsx                   (tier branch — consensus + per-player boards)
├── components/
│   ├── TierBoard.tsx                     (new — S/A/B/C/D rows with chips; shared by play + reveal)
│   ├── TierRow.tsx                       (new — one tier row / drop target)
│   └── TierChip.tsx                      (new — draggable/tappable item chip)
└── lib/
    ├── api.ts                            ('tier' in RoomMode; client fns)
    └── shuffle.ts                        (reused for per-player pool order)
```

The rejoin/active-room resume path (wherever `lobby.tsx`'s dispatch is mirrored) also gains the tier branch.

## Validation summary

- Mode at room creation: must be one of the known modes; tier forces `allow_suggestions` false.
- Tier room item add: rejected if it would push the total over 12.
- Tier room start: rejected unless item count is 3–12.
- Tier submit: rejected if room not `voting`, mode not `tier`, any item missing or duplicated, or any tier value invalid.
- `UNIQUE(item_id, voter_id)` catches a double lock-in at the DB layer.

## Testing

API (Vitest, matching existing conventions):
- Create tier room: `allow_suggestions` forced false; mode persisted.
- Add items: 13th rejected; Start with < 3 rejected; Start with 3–12 → voting.
- Submit board: missing item rejected; duplicate item rejected; invalid tier rejected; wrong mode rejected; double lock-in rejected.
- Averaging: known placements produce the expected tier and within-tier ordering; `.5` rounds up toward S.
- `/status`: completion requires a placement per item.
- `/results`: consensus + per-player boards; not revealed until participants ≥ 2 all locked in.

Mobile:
- Manual cross-platform check of drag on iOS simulator, Android emulator, and Expo web.
- Tap fallback works on each platform.
- Resume: lock in, kill app, reopen → board repaints from `myTiers`. Kill mid-arrangement → local draft restores.

## Open questions / future considerations

- Custom or renamed tiers (e.g., "F" tier, themed labels) — defer until requested.
- Per-item spread popup on the Consensus board — the per-player boards cover the "who placed what" need for now.
- If a future mode needs draft persistence server-side, revisit whether tier's local-only draft should move server-side too.
