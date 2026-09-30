# Draft Game Mode — Design

**Date:** 2026-09-30
**Status:** Approved (design phase)

## Summary

Add a sixth game mode, **Draft** (`draft`). The host picks a topic ("Best pizza toppings",
"Movies to watch on a plane") and the players take turns _drafting_ entries for it, fantasy-draft
style, each trying to assemble the best list. Entries are free text typed by the drafting player;
nothing is added by the host ahead of time. **No entry can be taken twice** — once "Pepperoni" is
drafted it's off the board for everyone, so picking order matters. The host chooses between a
**snake** draft (1‑2‑3‑3‑2‑1) and a **circle** draft (1‑2‑3‑1‑2‑3), and how many picks each player
gets. When every player has made all their picks the room reveals: every player's list, in the
order it was drafted, side by side. There is no scoring; the argument over whose list is best is the
game.

## Decisions and assumptions

- **The host plays.** As in every other mode, the host is a participant and gets a seat in the
  draft. (The request said "the other players" take turns; a host who only watches would be an odd
  fit for a room of three friends. If a spectator host is wanted later, it's a room setting.)
- **Free-text picks, deduplicated server-side.** Duplicates are detected on a normalized key:
  trimmed, whitespace collapsed to one space, lower-cased (`toLowerCase()` in JS, not SQLite's
  ASCII-only `lower()`). "Pepperoni", "pepperoni " and "PEPPERONI" are the same pick. Two different
  spellings ("Pepperoni" vs "Peperoni") are not; that's the group's problem to police, like any real
  draft.
- **Snake vs circle for two players.** With two seats the two orders differ only in whether the
  second player gets back-to-back picks. The setting is shown regardless; nothing special-cases two
  players.
- **Turn order is drawn at random when the host starts**, so the host has no advantage from
  creating the room. The order is fixed for the whole draft.
- **No joining once the draft has started.** Every other mode allows joining while `voting`; a
  draft can't seat a latecomer without invalidating the order. Rejoining (renaming) as an existing
  participant is still allowed. This is a new `joinAfterStart` rule in `MODE_RULES`.
- **No waiting screen.** Between turns players stay on the draft board watching picks land, and the
  board itself routes to the results when the draft completes. The waiting screen's
  `IN_PROGRESS_LABELS` still needs a `draft` entry for exhaustiveness.
- **Force-reveal works mid-draft** (the existing host `POST /reveal`). Results then show partial
  lists; the app's results view must not assume every player has the same number of picks.
- **No series / keep playing** (`series: false`). Can be added later like blind rank.
- **No items.** `MODE_RULES.draft` has `minItems: 0, maxItems: 0`, so `POST /items` rejects any
  add and `canStartWithItems` is satisfied with none. The host's setup screen shows draft settings
  where the item editor would be.

## Rules (`packages/shared/src/modes.ts`)

```ts
draft: {
  label: "draft",
  itemNoun: "items",
  minItems: 0,
  maxItems: 0,
  maxItemLength: 100,   // also the max length of a pick
  suggestions: false,
  minPlayersToStart: 2,
  minPlayersToReveal: 2,
  series: false,
  joinAfterStart: false, // NEW field on ModeRules; true for every existing mode
}
```

Draft-specific constants and pure turn logic live in **`packages/shared/src/draft.ts`** (exported
from the package index) so the API enforces them and the app can preview the order:

```ts
export const DRAFT_ORDERS = ["snake", "circle"] as const;
export type DraftOrder = (typeof DRAFT_ORDERS)[number];
export function isDraftOrder(v: unknown): v is DraftOrder;
export const DRAFT_ROUNDS = { min: 1, max: 10, default: 5 } as const;
/** How many picks a full draft has. */
export function totalPicks(seats: number, rounds: number): number; // seats * rounds
/** Which seat (0-based) picks at `pickIndex` (0-based). Snake reverses odd rounds. */
export function seatForPick(order: DraftOrder, seats: number, pickIndex: number): number;
/** The round (0-based) that `pickIndex` belongs to. */
export function roundForPick(seats: number, pickIndex: number): number; // floor(pickIndex / seats)
/** The pick's normalized key for duplicate detection. */
export function pickKey(title: string): string; // trim, collapse whitespace, toLowerCase
```

Snake: round `r` goes forward when `r` is even and backwards when odd. Circle: always forward.
Seats are 0-based positions in the drawn order.

## Data model (migration `0011_draft_mode.sql`)

```sql
-- Host settings for draft rooms; NULL for every other mode.
ALTER TABLE rooms ADD COLUMN draft_order TEXT;      -- 'snake' | 'circle'
ALTER TABLE rooms ADD COLUMN draft_rounds INTEGER;  -- picks per player, 1..10

-- The drawn turn order, written once when the room starts.
CREATE TABLE draft_seats (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  voter_id TEXT NOT NULL,
  seat INTEGER NOT NULL,                 -- 0-based position in the order
  PRIMARY KEY (room_id, seat),
  UNIQUE (room_id, voter_id)
);

-- One row per pick. pick_index is the global 0-based pick number; the UNIQUE
-- constraints are what make "whose turn is it" and "no duplicates" race-safe.
CREATE TABLE draft_picks (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  pick_index INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,               -- pickKey(title)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, pick_index),
  UNIQUE (room_id, title_key)
);
CREATE INDEX idx_draft_picks_room_voter ON draft_picks(room_id, voter_id);
```

Mirror all of this in `src/db/schema.sql`. Add `draft_picks` and `draft_seats` to `CHILD_TABLES` in
`src/lib/cleanup.ts` (and to the table list in `test/expiry.test.ts`). `Room` in `queries.ts` gains
`draft_order: DraftOrder | null; draft_rounds: number | null`.

## API

### Changes to existing endpoints

- **`POST /rooms`** accepts `draftOrder` (`"snake"` | `"circle"`, default `"snake"`) and
  `draftRounds` (integer 1–10, default 5). Both are validated only when `mode === "draft"` and
  ignored (stored NULL) otherwise. Errors: `400 VALIDATION_ERROR`.
- **`GET /rooms/:code`** includes `draftOrder` and `draftRounds` for draft rooms (absent for other
  modes). Draft rooms never list items (`showItems` is always false).
- **`PATCH /rooms/:code/settings`** body fields become individually optional:
  `allowSuggestions?`, `draftOrder?`, `draftRounds?`. At least one must be present. `draftOrder` /
  `draftRounds` are `400 INVALID_STATUS` in non-draft rooms; `allowSuggestions` keeps its existing
  behaviour. Response echoes the room's current `{ success, allowSuggestions, draftOrder,
  draftRounds }` (the draft fields only for draft rooms). Existing tests that send only
  `allowSuggestions` must still pass.
- **`POST /rooms/:code/join`** returns `400 INVALID_STATUS` ("The draft has already started") when
  the room is `voting`, the mode's `joinAfterStart` is false, and the voter is not already a
  participant. The check lives in the shared join route and reads `MODE_RULES`, not the mode name.
- **`POST /rooms/:code/start`** already enforces `minPlayersToStart` (2) via `MODE_RULES`. The
  draft handler's `onStart` draws the order: shuffle the participants (Fisher–Yates) and insert one
  `draft_seats` row per participant.

### Draft handler (`src/modes/draft.ts`, registered as `draft` in `modes/index.ts`)

- `submitPath: "/picks"`.
- `showItems`: always `false`.
- `onStart`: draw seats as above.
- `progress`: every participant, `completed` when they have `draft_rounds` picks. Only seated
  participants can ever have picks, and only participants are listed, so this is what
  `maybeReveal` needs. `extra: { picksMade, totalPicks }`.
- `statusExtra`: `{ currentPick: { participantId, name } | null }` — the seat on the clock, or
  `null` once the draft is complete or the room revealed.
- `results`: see below.

### `GET /rooms/:code/draft?voterId=` (new, `src/routes/draft.ts`)

The board. Polled by the play screen. `400 INVALID_STATUS` while `open` or for non-draft rooms.

```json
{
  "status": "voting",
  "draftOrder": "snake",
  "rounds": 5,
  "totalPicks": 15,
  "seats": [
    { "seat": 0, "participantId": "uuid", "name": "Alex", "isCreator": true, "isYou": false }
  ],
  "picks": [
    {
      "pickIndex": 0,
      "round": 0,
      "seat": 0,
      "participantId": "uuid",
      "name": "Alex",
      "title": "Pepperoni"
    }
  ],
  "current": {
    "pickIndex": 3,
    "round": 1,
    "seat": 2,
    "participantId": "uuid",
    "name": "Mia",
    "isYou": true
  },
  "complete": false
}
```

- `seats` in draft order. `picks` in pick order (this is public: everyone sees what's been taken).
- `current` is `null` when `complete` is true or the room is `revealed`/`closed`. `status` is the
  room status so the client can route to results.
- Never includes voter ids.

### `POST /rooms/:code/picks` (new)

```json
{ "voterId": "uuid", "voterName": "Mia", "title": "Mushrooms" }
```

Validation, in order:

1. `voterId` string, `voterName` valid name, `title` string with 1–`maxItemLength` characters after
   trimming → else `400 VALIDATION_ERROR`.
2. Room exists; `wrongModeError`; status must be `voting` → `400 INVALID_STATUS`.
3. Voter is a participant → else `400 VALIDATION_ERROR`.
4. Count existing picks → `pickIndex`. If `pickIndex >= totalPicks` → `400 INVALID_STATUS` ("The
   draft is complete").
5. `seatForPick(...)` must be this voter's seat → else **`400 NOT_YOUR_TURN`** with the message
   "It's {name}'s turn" (new error code; use `errorResponse`).
6. `INSERT` with `pick_index = pickIndex`, `title` trimmed, `title_key = pickKey(title)`.
   On a UNIQUE violation (`isUniqueViolation`): if a row with this `title_key` exists →
   **`409 DUPLICATE_PICK`** ("{title} has already been drafted"); otherwise another pick landed
   first → `400 NOT_YOUR_TURN` (recompute the name). Never a 500.
7. If this was the last pick, `maybeReveal(db, room)`.

**201**
`{ "success": true, "pick": { "pickIndex", "round", "seat", "title" }, "complete": boolean, "isRevealed": boolean }`.

Do not pre-check the duplicate with a SELECT; the constraint is the check (see CLAUDE.md
conventions: never read-then-write for state that can race).

### Results (`GET /rooms/:code/results` once revealed)

```json
{
  "revealed": true,
  "mode": "draft",
  "topic": "Best pizza toppings",
  "draftOrder": "snake",
  "rounds": 5,
  "totalPicks": 15,
  "picksMade": 15,
  "players": [
    {
      "seat": 0,
      "participantId": "uuid",
      "name": "Alex",
      "isCreator": true,
      "isYou": false,
      "picks": [{ "pickIndex": 0, "round": 0, "title": "Pepperoni" }]
    }
  ]
}
```

- `players` in seat order (draft order), each with their picks in pick order. A force-reveal leaves
  some lists short; they're still included.
- Pending results (`revealed: false`) carry `picksMade` and `totalPicks` via `progress.extra`.

### Errors

Add to the errors table in `APISPEC.md`:

| Code             | Status | Meaning                             |
| ---------------- | ------ | ----------------------------------- |
| `NOT_YOUR_TURN`  | 400    | Another seat is on the clock        |
| `DUPLICATE_PICK` | 409    | That entry has already been drafted |

## App

### Mode facts (`lib/modes.ts`)

- `MODE_TITLES.draft = "Draft"`, `START_LABELS.draft = "Start Draft"`,
  `IN_PROGRESS_LABELS.draft = "Drafting..."`, `PLAY_SCREENS.draft = "/room/[code]/draft"`.
- `startBlocker` needs no change: zero items satisfy the range, and the player rule already reads
  `minPlayersToStart`.

### Create flow

- **`create/mode.tsx`**: a sixth card, "Draft" — "Pick a topic. Take turns drafting the best
  entries you can think of — once something's taken, it's gone." Accent border colour distinct from
  the other cards (`PLAYER_COLORS[4].border`, the pink, is unused so far).
- **`create/index.tsx`**: for draft mode, below the name, a **`DraftSettings`** panel
  (`components/share/DraftSettings.tsx`): a two-option segmented control **Snake / Circle** with a
  one-line hint under the selected option ("Order reverses every round" / "Same order every round"),
  and a **Picks per player** stepper (−/+, 1–10, default 5). Values go to `createRoom` as
  `draftOrder` / `draftRounds`.
- **`create/share.tsx`**: for draft mode render `DraftSettings` in place of `ItemEditor` (no item
  editing, no saved-list import/save), wired to `updateRoomSettings`, with the same optimistic
  update-and-revert-on-error pattern as the suggestions toggle. A short caption above it: "Players
  draft their own entries once you start." Everything else (code card, participant chips, start
  button and its blocker text, close) is unchanged.

### Lobby (`room/[code]/lobby.tsx`)

For draft rooms the subheading reads "The host will start the draft soon. Get your list ready!".
No other change; the item section is already gated on `allowSuggestions`.

### Play screen (`room/[code]/draft.tsx`, new)

Polls `GET /draft` every 2.5 s with `usePolling`. Layout, top to bottom:

1. Topic, then "Round 2 of 5 · Pick 7 of 15".
2. **Order strip**: horizontally scrollable chips for each seat in draft order, coloured with
   `getPlayerColor(seat)`, the seat on the clock enlarged/outlined, finished seats dimmed. "You"
   marks your own chip.
3. **Your turn** (when `current.isYou`): a text input (max `maxItemLength`, auto-focus,
   `returnKeyType="done"`) and a **Draft it** button. On `DUPLICATE_PICK` show the message inline
   under the input and keep the text; on `NOT_YOUR_TURN` just re-poll. While it's someone else's
   turn show "Waiting for {name}…" with the pulsing dot from the lobby.
4. **Boards**: one card per seat (in draft order) listing that player's picks numbered by round,
   with an empty slot placeholder for picks not yet made. The most recent pick anywhere gets a
   brief `FadeInDown` entrance.
5. Leave Room link at the bottom.

Routing: when the payload's `status` is `revealed`, `router.replace` to results. `closed` → alert
and home, as the lobby does. Room-expired → same as the lobby.

Desktop web: cap content width (~560) and centre, as the other play screens do.

### Results (`components/results/DraftResults.tsx`, `room/[code]/results.tsx`)

Topic heading, "Snake draft · 5 rounds" meta line, then a card per player in seat order (you
highlighted, host badge as elsewhere) listing their picks in order. Below, a collapsible **Pick
order** section: the full pick log "1. Alex — Pepperoni", "2. Mia — Mushrooms", … with round
separators. `headline()` in `saved-results.ts` returns `null` for draft (there's no winner).

### API client (`lib/api.ts`)

- `createRoom` body gains `draftOrder?`, `draftRounds?`; `updateRoomSettings` body becomes
  `{ creatorVoterId; allowSuggestions?; draftOrder?; draftRounds? }`.
- `RoomResponse` gains `draftOrder?: DraftOrder; draftRounds?: number`.
- New: `DraftSeat`, `DraftPick`, `DraftResponse`, `getDraft(code, voterId)`,
  `submitPick(code, body)`, `SubmitPickResponse`, `DraftResults` (added to `RevealedResults`).
- `FRIENDLY_MESSAGES`: do **not** add `NOT_YOUR_TURN` / `DUPLICATE_PICK`; the server messages name
  the player / the entry and should be shown as is.

## Tests

- **shared** (`draft.test.ts`): `seatForPick` for snake and circle across several rounds and seat
  counts (including 2 seats), `roundForPick`, `totalPicks`, `pickKey` normalization,
  `isDraftOrder`. `modes.test.ts`: every mode has `joinAfterStart`.
- **API** (`test/draft.test.ts`): full snake draft with three players reveals with the right lists;
  circle order differs from snake for the same seats; picking out of turn → `NOT_YOUR_TURN`; a
  duplicate that differs only by case/whitespace → `409 DUPLICATE_PICK` and the turn doesn't
  advance; joining after start → `INVALID_STATUS` while rename of an existing participant still
  works; two simultaneous picks for the same slot leave exactly one row (`Promise.all`, like
  `races.test.ts`); force-reveal mid-draft returns partial lists; `GET /draft` before start →
  `INVALID_STATUS`; start with one player → `at least 2 players`; `draftRounds` out of range on
  create and settings → 400; `expectNoVoterIds` on `/draft`, `/status` and `/results`. Add the
  new tables to `expiry.test.ts`.
- **App** (`lib/modes.test.ts`): `roomScreen("voting", "draft", …)` and `playScreen("draft")`.

## Docs

`APISPEC.md` (mode table row, `POST /rooms`, `GET /rooms/:code`, `PATCH /settings`, join, new
endpoints, results, errors), `CLAUDE.md` (mode table row, lifecycle note about joining, `/draft`
in the voting bullet), `DECISIONS.md` (a short "Draft Turns Are Enforced by Unique Constraints"
entry: the pick index and normalized title uniqueness make the turn order and the no-duplicates
rule race-safe without a read-then-write, and why late joins are refused).
