# Blind Rank Game Mode — Design

**Date:** 2026-05-20
**Status:** Approved (design phase)

## Summary

Add a second game mode to This or That, called **Blind Rank**, alongside the existing Swipe Vote mode. The host picks a category and five items. Each player (host included) is shown the items one at a time, in the same server-randomized order, and must place each item into a numbered slot (1–5) by drag-and-drop. Once an item is placed, it is locked. When all participants have placed all five items, the reveal screen shows every player's full ranking side by side. No scoring; the reveal is purely for comparison and discussion.

## Goals

- Ship a second game mode that reuses the existing room lifecycle (create → add items → start → play → reveal).
- Establish a per-mode dispatch pattern so adding future modes is "add a folder," not "edit shared logic."
- Keep the existing Swipe Vote mode behaviorally unchanged.

## Non-goals

- Scoring, leaderboards, or any notion of a "correct" ranking.
- More than 5 items per blind-rank room (5 is fixed for now).
- Variable item counts (no host-configurable 3–7).
- Editing or undoing a placement.
- A general-purpose "game engine" abstraction. Add specific modes; refactor later when there are 2–3 concrete cases to draw from.

## User flow

### Creator
1. Home → tap **Create a Room**.
2. **NEW: Mode picker screen** — two cards, "Swipe Vote" and "Blind Rank." Tap one.
3. **Topic + name screen** — existing. In rank mode the "allow suggestions" toggle is hidden (would spoil the blind aspect).
4. **Add items screen** — existing screen, but in rank mode it enforces exactly 5 items. The Start button is disabled until 5 items exist; the input is disabled once 5 are entered.
5. **Share screen** — existing. Start button enabled once 5 items exist.
6. Tap **Start** — server locks items, generates a single random presentation order for the whole room, and transitions room to `voting`.
7. **NEW: Rank play screen** — creator gets the same blind-rank experience as participants. They know the pool (they typed it) but not the order in which items will appear.
8. **Waiting screen** — existing; "X of N done."
9. **NEW: Rank reveal screen** — vertical scroll, one card per player with their full top-5.

### Participant
1. Home → **Join a Room** → enter code → enter name (all existing).
2. **Lobby** — existing "waiting for host to start." In rank mode, items are never shown here regardless of any other setting.
3. **NEW: Rank play screen.**
4. **Waiting + Reveal** — same as creator.

### Routing dispatch
A new `app/room/[code]/_layout.tsx` (or a small index redirect) reads the room's `mode` and routes to either the existing `swipe.tsx` (vote mode) or the new `rank.tsx` (rank mode). The existing swipe screen does not learn about modes.

## Screens

### Mode picker (new)

First step inside Create. Two large cards:
- **Swipe Vote** — "Add a list of options. Everyone swipes yes or no. See what wins."
- **Blind Rank** — "Pick 5 items. Players rank them one at a time without knowing what's coming next."

### Rank play screen (new)

Layout (top to bottom):
- Header: room topic + progress ("2 of 5").
- Item card: the current item to place, centered, draggable.
- Five numbered slots stacked vertically below. Empty slots show a placeholder; filled slots show the item title and are visually locked.

Interaction:
- Drag the item card onto an empty slot. Empty slots highlight on hover/drag-over; filled slots dim and refuse drop.
- On release over an empty slot, the card animates into the slot, the slot locks, and the next item card appears at the top.
- On release outside any valid slot, the card springs back to its starting position.
- Slot 1 is "best/favorite"; slot 5 is "worst/least favorite." A subtle "TOP" hint sits near slot 1 on first paint, fades after the first placement.
- After the 5th placement, brief "all placed!" confirmation, then navigate to the existing waiting screen.

Accessibility fallback:
- Long-press on the item card opens a small menu with buttons "Place at 1 / 2 / 3 / 4 / 5" with already-used numbers disabled. Lets users who can't drag (e.g., assistive input) still play.

Cross-platform:
- Drag implemented with `react-native-gesture-handler` Pan + `react-native-reanimated` shared values (already used by swipe mode). Works on iOS, Android, and Expo web (web build of gesture-handler translates pointer events).
- Desktop layout caps content width (~480px) and centers; same UI with wider gutters.

### Rank reveal screen (new)

- Header: room topic + "N players ranked."
- Vertical scroll of player cards, one per participant.
- "You" is pinned first. The host shows a small badge (compact style consistent with existing host badge usage).
- Each card lists the player's full ranking 1–5 with item titles.

### Waiting screen (existing, minor update)

The existing waiting screen works for both modes. The only change: the per-voter status badge text. Today it reads "Swiping..." for in-progress voters; for rank rooms it should read "Ranking..." instead. The waiting screen reads the room's `mode` (already in the room details cache or via an extra field on `/status` if cleaner) and switches the in-progress label accordingly.

## Data model

New migration `apps/api/migrations/0005_blind_rank_mode.sql`:

```sql
-- Mode column on rooms (default keeps existing rooms as vote)
ALTER TABLE rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'vote';
-- Allowed values: 'vote' | 'rank'

-- Presentation order set when a rank room transitions to 'voting'.
-- Null for vote rooms and for rank rooms still in 'open'.
ALTER TABLE items ADD COLUMN presentation_order INTEGER;

CREATE TABLE rankings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, voter_id, item_id),  -- can't rank an item twice
  UNIQUE(room_id, voter_id, rank)      -- can't fill a slot twice
);

CREATE INDEX idx_rankings_room ON rankings(room_id);
CREATE INDEX idx_rankings_room_voter ON rankings(room_id, voter_id);
```

The `votes` table is untouched. Vote rooms continue using `votes`; rank rooms use `rankings`. Nothing polymorphic.

## API

### Existing endpoints (small additions)

- **`POST /api/rooms`** — accepts optional `mode: 'vote' | 'rank'` (default `'vote'`). For rank mode, server forces `allow_suggestions = false`.
- **`POST /api/rooms/:code/items`** — for rank rooms, total item count capped at 5 (instead of 15). Participant suggestions stay disabled.
- **`POST /api/rooms/:code/start`** — for rank rooms, validates exactly 5 items (rather than 2+). On start: generates a single random permutation of items and writes `presentation_order` (0..4) to each item row.
- **`GET /api/rooms/:code`** — response includes `mode`. For rank rooms in `voting` or `revealed` status, the items array is omitted (clients use `/next-item` and `/results` instead). Response includes `myRankings: { itemId: rank }` if `voterId` is provided, mirroring `myVotes`.
- **`GET /api/rooms/:code/status`** — for rank rooms, a participant is "complete" when they have exactly 5 rankings in the room (instead of "votes for all items"). Response shape unchanged (`totalVoters`, `completedCount`, `isRevealed`, `voters`).

### New endpoints (rank-specific, in `apps/api/src/routes/rankings.ts`)

- **`GET /api/rooms/:code/next-item?voterId=X`** — returns the next item the player should rank: the item with the lowest `presentation_order` they have not yet ranked. Response: `{ item: { id, title } | null, progress: { placed, total: 5 } }`. `item: null` means the player is done.
- **`POST /api/rooms/:code/rankings`** — body `{ itemId, voterId, voterName, rank }`. Server validates room is rank mode + `voting` status; rank is 1–5; UNIQUE constraints catch duplicates. Returns `{ success: true, progress: { placed, total: 5 } }`.
- **`GET /api/rooms/:code/results`** — for rank rooms, response is `{ revealed: true, mode: 'rank', topic, players: [{ voterId, name, isCreator, rankings: [{ rank, itemId, title }] }] }`. Sorted with the requesting voter first if `voterId` provided. If not yet revealed, returns the same `{ revealed: false, completedCount, totalVoters }` shape used by vote mode.
- **Reveal trigger** — the existing `POST /api/rooms/:code/reveal` endpoint (creator-only) transitions a `voting` room to `revealed`. Used by both modes unchanged. The waiting screen continues to poll `/status` and navigates to results when `isRevealed` becomes true.

### Mode-mismatch errors

- `POST /api/rooms/:code/votes` on a rank room → 400 "wrong mode."
- `POST /api/rooms/:code/rankings` on a vote room → 400 "wrong mode."
- `PATCH /api/rooms/:code/settings` setting `allowSuggestions: true` on a rank room → 400.

### Why server-enforced blind

`/next-item` returns one item at a time rather than the full list, so a curious web player cannot open devtools and read the full ordered list from a single response. The cost is four extra GETs per game (negligible). It also gives clean resume-after-close behavior: the server tells the client what to show next, the client doesn't need to remember the order.

## Behavior notes

- **Resume after close:** when a player reopens the app mid-game, the client calls `/next-item` for the next card and reads `myRankings` from `GET /api/rooms/:code` to repaint locked slots.
- **Late joiners:** allowed after `start` (matches today's vote-mode behavior). They start at item #1 of the room's fixed presentation order and rank all 5. The reveal waits for them to finish.
- **Allow_suggestions in rank mode:** forced off at room creation; PATCH `/settings` rejects attempts to enable it on a rank room.

## File layout

```
apps/api/
├── migrations/
│   └── 0005_blind_rank_mode.sql         (new)
├── src/
│   ├── index.ts                          (mount rankings router)
│   ├── routes/
│   │   ├── rooms.ts                      (mode field, item caps, start validation)
│   │   ├── votes.ts                      (reject if mode='rank')
│   │   ├── rankings.ts                   (new — next-item, submit, results)
│   │   └── results.ts                    (dispatch on mode)
│   └── db/
│       └── queries.ts                    (rankings query helpers)

apps/mobile/
├── app/
│   ├── create/
│   │   ├── mode.tsx                      (new — mode picker, first step)
│   │   ├── index.tsx                     (topic + name; hide suggestions in rank)
│   │   └── share.tsx                     (existing; Start enabled at 5 items in rank)
│   └── room/[code]/
│       ├── _layout.tsx                   (new — read mode, dispatch screens)
│       ├── lobby.tsx                     (existing; no item view in rank mode)
│       ├── swipe.tsx                     (existing, vote-mode only)
│       ├── rank.tsx                      (new — drag-and-drop play screen)
│       ├── waiting.tsx                   (existing; works for both modes)
│       └── results.tsx                   (dispatch on mode)
├── components/
│   ├── RankSlot.tsx                      (new — drop target)
│   ├── RankCard.tsx                      (new — draggable item card)
│   └── RankPlayerCard.tsx                (new — reveal card per player)
└── lib/
    └── api.ts                            (new client functions for rankings)
```

## Validation summary

- Mode at room creation: must be `'vote'` or `'rank'`, defaults to `'vote'`.
- Rank room item add: rejected if would push total over 5.
- Rank room start: rejected if item count != 5.
- Rank submit: rejected if room not `voting`, mode not `rank`, rank not 1–5, voter not a participant.
- UNIQUE constraints in `rankings` catch double-submits and double-slotting at the DB layer.

## Testing

API (Vitest, matching existing test conventions where present):
- Create rank room: default `allow_suggestions` false; mode persisted.
- Add 5 items: 6th rejected.
- Start with <5 items: rejected. Start with 5: `presentation_order` set; status → voting.
- `/next-item`: returns lowest-presentation_order un-ranked item; null when done.
- Submit ranking: duplicate item rejected; duplicate rank rejected; wrong mode rejected.
- `/status`: completion based on 5 rankings per participant.
- `/results`: returns players + rankings; not revealed until all complete.

Mobile:
- Manual cross-platform check of drag-and-drop on iOS simulator, Android emulator, and Expo web.
- Long-press fallback works on each platform.
- Resume after close: kill app mid-game, reopen, locked slots repaint, next item is the right one.

## Open questions / future considerations

- If a future mode (trivia, prediction) needs multiple rounds, the `status` field will need more states or a separate `rounds` table. Address when the third mode lands, not now.
- If a future mode doesn't have an item list (e.g., a single secret prompt), the `items` table can either become optional (nullable `room_id` or simply unused for that mode) or that mode gets its own table. Decide at that point.
- Drag-and-drop on Expo web has some known rough edges on touchscreens; if it doesn't feel right in testing, the long-press fallback becomes the primary interaction on web.
