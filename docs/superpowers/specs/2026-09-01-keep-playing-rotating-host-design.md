# Keep Playing with a Rotating Host (Blind Rank) — Design

**Date:** 2026-09-01
**Status:** Approved (design phase)

## Summary

After a Blind Rank round is revealed, the host can choose to **keep playing**: they pick the next host (any participant, or a random draw that avoids repeats until everyone has hosted), that person creates a new category with 5 new items, and the whole group flows into the next round automatically — no codes re-shared, no re-typing names. Rounds are fully independent: no scoring, no cross-round leaderboard. The value of the feature is keeping the group together for round after round of blind ranking.

Mechanically, each new round is a **new room chained onto the previous one** (a "series"), not a reopened room. This keeps the one-way room lifecycle, the UNIQUE constraints on submission tables, and all six host-only endpoints completely unchanged — host rotation falls out of each round-room having its own creator.

## Goals

- Let a Blind Rank group play consecutive rounds seamlessly: non-hosts do zero taps between rounds.
- Rotate hosting: outgoing host picks the next host by name or randomly; random avoids repeats until everyone has hosted.
- Keep the existing room lifecycle, submission-table constraints, and host-authorization model untouched.
- Shape the data model so other modes could adopt series later without a schema rewrite (but ship only on rank).

## Non-goals

- Scoring, leaderboards, or any state carried across rounds.
- Round history browsing (each reveal is viewed once, in its round).
- Keep-playing for vote / bracket / most-likely-to / tier modes (data model must not preclude it; UI is rank-only).
- An explicit "end series" action — the host simply not picking a next host ends the session.
- Locking the group — new people may still join mid-series via the room code.

## User flow

Say round 1 just revealed and Dana is the current host.

### Outgoing host (Dana)

1. Rank results screen shows a **"Keep playing"** button (host only).
2. Tapping it opens a **next-host picker**: the participant list, plus a **"Pick randomly"** option. Random draws from participants who haven't hosted yet this series; when everyone has hosted, the pool resets (excluding Dana so there's no back-to-back repeat). Manual pick can choose anyone, including a repeat or Dana herself.
3. Dana can re-open the picker and change the pick any time until the next round's room is actually created.

### Picked host (Alex)

1. Alex's results screen swaps its banner for **"You're up! Create the next category"**.
2. Tap → existing create flow: category (topic) screen → 5-item entry on the share screen → **Start**. Alex's display name is already known and never re-entered. The share screen still shows the new round's code for inviting someone new; the existing group doesn't need it.
3. On Start, Alex lands on the rank play screen as usual.

### Everyone else

1. Within ~3s of Dana's pick (one poll interval), a banner appears on the results screen: **"Alex is up next — waiting for their category…"**. Nothing is blocked; they keep looking at round-1 results.
2. The moment Alex's room exists, their client **auto-joins in the background** (single `/join` call with stored voterId + display name) and transitions to the round-2 lobby: "Round 2: 〈category〉 — waiting for Alex to start". Zero taps.
3. The existing lobby polling hops them into the rank screen when Alex starts. Round 2 plays identically to round 1.

### Latecomers and stragglers

- Someone entering an **older round's code** on the join screen is transparently forwarded to the current round's room (server resolves the newest room in the series).
- A backgrounded phone catches up on reopen: the same poll/forwarding lands it in the current round. Missed rounds are simply missed (rounds are independent).

## Data model

New migration `apps/api/migrations/0009_room_series.sql` — columns on `rooms` only; no other table changes:

```sql
-- Id of the first room in the chain. NULL = standalone room / not (yet) a series.
ALTER TABLE rooms ADD COLUMN series_id TEXT;

-- 1 for standalone and first rooms; successor = previous + 1. Display only ("Round 3").
ALTER TABLE rooms ADD COLUMN round_number INTEGER NOT NULL DEFAULT 1;

-- Voter id of the picked next host. Private — never returned to clients
-- (responses expose the next host's participantId + name instead).
ALTER TABLE rooms ADD COLUMN next_host_voter_id TEXT;

-- Set when the successor room is created. Doubles as the "series continued" flag.
ALTER TABLE rooms ADD COLUMN next_room_id TEXT;

CREATE INDEX idx_rooms_series ON rooms(series_id);
```

Derived facts, no new tables:

- **A successor inherits** `series_id = previous.series_id ?? previous.id` and `round_number = previous.round_number + 1`. The first room's own `series_id` is backfilled to its id when its first successor is created.
- **"Who has hosted this series"** = the distinct `creator_voter_id` values of rooms in the series. Powers the random no-repeat rule.
- **"Current round of a series"** = the room with the highest `round_number` for a `series_id`. Powers latecomer forwarding.
- Each round-room gets its own fresh 48h `expires_at`, so a long game night never dies mid-series.

## API

### New endpoint: `POST /api/rooms/:code/next-host`

In `apps/api/src/routes/rooms.ts` (host action, alongside `/start` and `/close`).

- **Body:** `{ creatorVoterId: string, nextParticipantId?: string }` — omit `nextParticipantId` for a random draw.
- **Validation:** caller is the room's creator; room `status = 'revealed'`; room `mode = 'rank'`; if provided, `nextParticipantId` is a participant of this room.
- **Random draw:** among participants whose `voter_id` is not a `creator_voter_id` of any room in the series; if that pool is empty (everyone has hosted), reset to all participants except the current host — unless the current host is the only participant left to pick.
- **Effect:** writes `next_host_voter_id` (overwriting any previous pick). Rejected with 409 once `next_room_id` is set.
- **Returns:** `{ nextHost: { participantId: string, name: string } }`.

### Extended: `POST /api/rooms`

- Accepts optional `previousRoomCode: string`.
- **Validation:** previous room exists (and is not expired), `status = 'revealed'`, `mode = 'rank'`, and the caller's `creatorVoterId` equals its `next_host_voter_id`. Failure → 403 with a friendly "the host picked someone else" style message.
- **Effect:** creates the room exactly as today (new code, `mode = 'rank'`, caller auto-joined as creator/participant, fresh 48h expiry, topic from body), plus `series_id` / `round_number` per the inheritance rules. Then stamps the previous room with `UPDATE rooms SET next_room_id = ?, series_id = COALESCE(series_id, id) WHERE id = ? AND next_room_id IS NULL`. Sequence (D1 batches can't conditionally abort, so the conditional update is the arbiter): create the new room + participant rows, run the link update, and if it matches 0 rows (a race already linked a successor) delete the just-created orphan rows and return 409 — the client then follows the existing `nextRoomCode`. This mirrors the guarded-conditional-UPDATE pattern already used by `/start`.

### Extended: `GET /api/rooms/:code/status`

For revealed rank rooms, adds:

- `nextHost: { participantId, name } | null` — resolved from `next_host_voter_id` via the participants table.
- `nextRoomCode: string | null` — the code of the **newest room in the series** (not merely the immediate successor), so multi-round-behind clients forward in one hop. Null until a successor exists.
- `roundNumber: number` — for "Round 2" display.

### Extended: `GET /api/rooms/:code`

- Adds `nextRoomCode` (same newest-in-series resolution) and `roundNumber`. The join screen uses `nextRoomCode` to forward latecomers holding an old code.

No other endpoint changes. The six host-only endpoints keep their inline `creator_voter_id` checks untouched, because each round-room has its own creator.

## Mobile

### Rank results screen (`app/room/[code]/results.tsx`, rank branch)

- **Polls `/status` every ~3s** once results render (today the screen is one-shot). Stops on unmount or when `nextRoomCode` arrives.
- Host: **"Keep playing"** button → next-host picker (participants from `/participants`, plus "Pick randomly") → `POST /next-host`. Re-openable to change the pick until the next round exists.
- All: once `nextHost` is set, banner "〈name〉 is up next — waiting for their category…".
- Picked host (own `participantId === nextHost.participantId`): banner is a **"You're up! Create the next category"** button → routes into the create flow carrying `previousRoomCode`.
- All others: when `nextRoomCode` appears → background `joinRoom(nextRoomCode, voterId, name)` → `router.replace` to the new room's lobby.

### Create flow (`app/create/index.tsx`, `share.tsx`)

- Accepts an optional `previousRoomCode` route param; when present, skips the mode picker (mode is rank), skips name entry (name already known), and `createRoom` sends `previousRoomCode`. A 403/409 here (re-picked host or already-continued series) shows a friendly message and returns to the results screen.

### Lobby / waiting (`lobby.tsx`, `waiting.tsx`)

- Display "Round N" from `roundNumber` when > 1. No behavioral changes — existing polling handles the rest.

### Active-room persistence (`lib/storage.ts` + results screen)

- Today `clearActiveRoom()` fires as soon as results render, killing the home-screen rejoin banner. Change for rank rooms: keep the active room saved on the results screen; **re-save it with the new code** when auto-joining a successor; clear it only when the user leaves via "Back to Home". The stored active-room record also carries the display name so auto-join can pass it.

### Join screen (`app/join/index.tsx` / `name.tsx`)

- If `GET /rooms/:code` returns a `nextRoomCode`, retarget to that code transparently before the normal status/mode routing.

## Edge cases

- **Picked host bails:** outgoing host re-picks; the bailed host's in-flight `createRoom` fails the `next_host_voter_id` check (403) → friendly message → back to results.
- **Double-create race:** the conditional `WHERE next_room_id IS NULL` update guarantees exactly one successor; the loser gets 409 and follows `nextRoomCode`.
- **Two players:** the no-repeat random rule naturally alternates them.
- **Pool reset:** excludes the just-finished host, so never a back-to-back random repeat (unless they're the only eligible pick).
- **Nobody continues:** identical to today — the room dies at its 48h expiry.
- **Old room expires mid-lookup:** a latecomer with a >48h-old code gets the normal 404; acceptable, since active series always have a fresh newest room and in-app clients follow `nextRoomCode` long before expiry.
- **New joiner mid-series:** joins the current round's room via forwarding; participates from that round onward; may be picked as a future host like anyone else.

## Validation summary

- `/next-host`: creator-only; `revealed` + `rank` only; `nextParticipantId` must belong to the room; 409 after the series has continued.
- `POST /api/rooms` with `previousRoomCode`: 403 unless caller is the designated next host of a revealed rank room; 409 if the series already continued.
- `next_host_voter_id` never appears in any response; clients only ever see the next host's `participantId` + name.

## Testing

API (Vitest; if no harness exists yet for these routes, bootstrap a minimal one as part of the work):

- `/next-host`: non-creator rejected; wrong status/mode rejected; unknown participant rejected; manual pick returns that participant; random pick excludes prior series hosts; pool reset excludes current host; re-pick overwrites; 409 after successor exists.
- Successor creation: valid next host succeeds with correct `series_id` / `round_number` / `next_room_id` stamping; non-designated caller 403; second create attempt 409 (double-create guard); first room's `series_id` backfilled.
- `/status` + `GET /rooms/:code`: `nextHost` and `nextRoomCode` exposure; newest-in-series resolution across 3 chained rooms; `roundNumber` correct.

Mobile: manual end-to-end pass — create → play → reveal → keep playing (manual pick and random) → round 2 → verify auto-join with no taps, latecomer forwarding from a round-1 code, and re-pick after a bailed host.

## Future considerations

- Other modes adopting series: the `rooms` columns are mode-agnostic; only `/next-host` validation and results-screen UI gate on rank. Lifting the gate + per-mode create-flow wiring is the whole job.
- If cross-round scoring is ever wanted, that's the point to revisit the multi-round-room alternative (round columns on submission tables); the series model keeps rounds independent by construction.
