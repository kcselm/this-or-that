# API Specification

Base URL: `https://tot-api.kcselm93.workers.dev/api` (local: `http://localhost:8787/api`)

All requests and responses are JSON. Timestamps are ISO 8601 UTC.

**Conventions**

- `:code` is the 6-character room code (case-insensitive).
- `voterId` / `creatorVoterId` are the caller's anonymous device id — the only credential. They are sent by the client but **never returned** by any endpoint. Other players are identified by their public `participantId`.
- Unless noted, every endpoint returns `404 ROOM_NOT_FOUND` for unknown or expired rooms.
- Per-mode limits (item counts, title lengths, player minimums) come from `MODE_RULES` in `packages/shared/src/modes.ts`:

| Mode      | Items        | Title length | Players to start | Players to auto-reveal | Suggestions |
| --------- | ------------ | ------------ | ---------------- | ---------------------- | ----------- |
| `vote`    | 2–15         | 100          | 1                | 2                      | yes         |
| `rank`    | exactly 5    | 100          | 1                | 2                      | no          |
| `bracket` | 4–16         | 100          | 1                | 2                      | no          |
| `mlt`     | 3–15 prompts | 80           | 3                | 3                      | yes         |
| `tier`    | 3–12         | 100          | 1                | 2                      | no          |

## Rooms

### POST /rooms

Create a room. The creator is joined as its first participant.

```json
{
  "topic": "Friday dinner",
  "creatorVoterId": "uuid",
  "creatorName": "Alex",
  "mode": "vote",
  "allowSuggestions": false,
  "previousRoomCode": "HK7M3N"
}
```

- `topic`: 1–100 characters after trimming. `creatorName`: 1–30 after trimming.
- `mode`: optional, defaults to `vote`.
- `allowSuggestions`: optional; ignored for modes that don't allow suggestions.
- `previousRoomCode`: optional, blind rank only. Chains this room onto a revealed rank room as its next round. Only the next host that room's host picked may do this.

**201**

```json
{
  "id": "uuid",
  "code": "HK7M3N",
  "topic": "Friday dinner",
  "mode": "vote",
  "createdAt": "2026-09-29T10:00:00.000Z",
  "expiresAt": "2026-10-01T10:00:00.000Z",
  "roundNumber": 1
}
```

Errors: `400 VALIDATION_ERROR`; with `previousRoomCode`: `400 INVALID_STATUS` (not revealed / not rank), `403 NOT_NEXT_HOST`, `409 SERIES_CONTINUED` (next round already exists).

### GET /rooms/:code?voterId=

Room details. Pass `voterId` to get your own submissions back for resuming.

**200**

```json
{
  "id": "uuid",
  "code": "HK7M3N",
  "topic": "Friday dinner",
  "status": "voting",
  "allowSuggestions": false,
  "mode": "vote",
  "items": [{ "id": "uuid", "title": "Tacos", "addedBy": null }],
  "myVotes": { "item-uuid": "yes" },
  "roundNumber": 1,
  "nextRoomCode": "Q7W2ZK"
}
```

- `status`: `open` | `voting` | `revealed` | `closed`.
- `items`, in the host's order (clients shuffle per player). While `open`, only the host sees them, unless it's a `vote` room with suggestions on. Once started, blind rank and bracket rooms never list items here — they're dealt by `/next-item` and `/bracket`. `addedBy` names a participant who suggested the item.
- Resume state, only with `voterId`: `myVotes` (vote: itemId → `yes`|`no`), `myRankings` (rank: itemId → rank), `myMltVotes` (mlt: itemId → participantId), `myTiers` (tier: itemId → tier).
- `nextRoomCode`: present when a later round of this room's series exists.

### POST /rooms/:code/join

Join, or rename yourself if already joined. Allowed while `open` or `voting`.

```json
{ "voterId": "uuid", "voterName": "Jordan" }
```

**200** `{ "success": true }`. Errors: `400 INVALID_STATUS` if closed or revealed.

### GET /rooms/:code/participants?voterId=

**200**

```json
{
  "participants": [{ "participantId": "uuid", "name": "Alex", "isCreator": true, "isYou": false }]
}
```

In join order. `isYou` is set when `voterId` matches.

### POST /rooms/:code/items

Add items while the room is `open`. The host adds in bulk; participants may add one at a time if suggestions are on.

```json
{ "items": ["Tacos", "Sushi"], "creatorVoterId": "uuid" }
```

or a participant suggestion:

```json
{ "item": "Pho", "voterId": "uuid", "voterName": "Jordan" }
```

**201**

```json
{
  "items": [{ "id": "uuid", "title": "Tacos", "sortOrder": 0 }],
  "totalItems": 2
}
```

Errors: `400 VALIDATION_ERROR` (empty or too-long titles, over the mode's item limit, not a participant), `400 INVALID_STATUS` (not open, suggestions off or not allowed for the mode).

### DELETE /rooms/:code/items/:itemId?creatorVoterId=

Host only, while `open`. **200** `{ "success": true, "totalItems": 4 }`. Errors: `403 NOT_CREATOR`, `400 INVALID_STATUS`, `404` for an unknown item.

### PATCH /rooms/:code/settings

Host only, while `open`.

```json
{ "creatorVoterId": "uuid", "allowSuggestions": true }
```

**200** `{ "success": true, "allowSuggestions": true }`. Errors: `400 INVALID_STATUS` for modes without suggestions.

### POST /rooms/:code/start

Host only. Moves `open` → `voting` atomically (a second concurrent start gets a 400). Blind rank rooms get their shared deal order; bracket rooms get round 1.

```json
{ "creatorVoterId": "uuid" }
```

**200** `{ "success": true, "status": "voting", "itemCount": 5, "mode": "vote" }`. Errors: `400 VALIDATION_ERROR` (item count outside the mode's range, too few players), `400 INVALID_STATUS` (already started), `403 NOT_CREATOR`.

### POST /rooms/:code/close

Host only. Ends an `open` or `voting` room for everyone. **200** `{ "success": true, "status": "closed" }`. Errors: `400 INVALID_STATUS` if already closed or revealed.

## Playing

Every submission requires the caller to have joined, the room to be `voting`, and the right endpoint for the room's mode — otherwise `400` with a message naming the right endpoint. When a submission completes the last player, the room reveals itself (bracket: when the final is decided).

### POST /rooms/:code/votes — `vote`

```json
{ "itemId": "uuid", "voterId": "uuid", "voterName": "Jordan", "vote": "yes" }
```

Upserts: voting again on an item changes the vote. **201** `{ "success": true, "progress": { "voted": 3, "total": 5 } }`.

### GET /rooms/:code/next-item?voterId= — `rank`

The next item to place, in the room's shared random order, or `null` when done. **200** `{ "item": { "id": "uuid", "title": "Up" }, "progress": { "placed": 2, "total": 5 } }`.

### POST /rooms/:code/rankings — `rank`

```json
{ "itemId": "uuid", "voterId": "uuid", "voterName": "Jordan", "rank": 1 }
```

Placements are final: re-placing an item or reusing a rank is a `400`. **201** `{ "success": true, "progress": { "placed": 3, "total": 5 } }`.

### GET /rooms/:code/bracket?voterId= — `bracket`

Rounds created so far. Future rounds don't exist until the previous one closes.

```json
{
  "currentRound": 2,
  "totalRounds": 3,
  "rounds": [
    {
      "round": 1,
      "matchups": [
        {
          "id": "uuid",
          "slot": 0,
          "itemA": { "id": "uuid", "title": "Chips" },
          "itemB": { "id": "uuid", "title": "Popcorn" },
          "winner": { "id": "uuid", "title": "Popcorn" },
          "isBye": false,
          "decidedByTiebreak": false,
          "voteBreakdown": [{ "voterName": "Alex", "pickedItemId": "uuid", "isYou": true }]
        }
      ]
    }
  ],
  "myVotes": { "matchup-uuid": "picked-item-uuid" }
}
```

- `currentRound` is `null` once revealed. A bye has `itemB: null` and is decided up front.
- `voteBreakdown` only appears on decided matchups in past rounds, so nobody sees the current round's votes.
- Ties are settled by coin flip (`decidedByTiebreak`).

### POST /rooms/:code/matchup-votes — `bracket`

```json
{ "matchupId": "uuid", "voterId": "uuid", "voterName": "Jordan", "pickedItemId": "uuid" }
```

Only matchups in the current round; one vote each. **201** `{ "success": true, "progress": { "votedThisRound": 1, "totalThisRound": 2 } }`.

### GET /mlt/prompts — `mlt`

The curated prompt library for the host's picker. **200** `{ "prompts": [{ "id": "ghost-group-chat", "text": "Most likely to…", "tags": [] }] }`.

### POST /rooms/:code/mlt-votes — `mlt`

```json
{ "itemId": "uuid", "voterId": "uuid", "voterName": "Jordan", "targetParticipantId": "uuid" }
```

Upserts: voting again on a prompt changes the pick. **201** `{ "success": true, "progress": { "voted": 2, "total": 5 } }`.

### POST /rooms/:code/tiers — `tier`

Lock in a whole board at once. Every item must be placed exactly once in `S`, `A`, `B`, `C`, or `D`; a second lock-in is a `400`.

```json
{
  "voterId": "uuid",
  "voterName": "Jordan",
  "placements": [{ "itemId": "uuid", "tier": "S" }]
}
```

**201** `{ "success": true, "progress": { "placed": 4, "total": 4 }, "isRevealed": false }`.

## Progress and results

### GET /rooms/:code/status

Polled by the lobby and waiting screens.

```json
{
  "totalVoters": 3,
  "completedCount": 2,
  "isRevealed": false,
  "voters": [{ "name": "Alex", "completed": true }]
}
```

- A voter is complete once they've submitted for every item (bracket: every real matchup in the current round).
- Bracket adds `currentRound` (`null` once revealed) and `totalThisRound`.
- Blind rank adds `roundNumber`, `nextHost` (`{ participantId, name }` or `null`), and `nextRoomCode` (or `null`) for keep-playing.

### GET /rooms/:code/results?voterId=

Before the reveal:

```json
{ "revealed": false, "mode": "vote", "completedCount": 2, "totalVoters": 3 }
```

(Bracket adds `currentRound` and `totalThisRound`.)

After the reveal, every response has `revealed: true`, `mode`, and `topic`, plus:

- **vote** — `totalVoters` and `results: [{ itemId, title, yesCount, noCount, yesPercentage }]`, highest yes-percentage first (ties keep the host's order).
- **rank** — `players: [{ participantId, name, isCreator, isYou, rankings: [{ rank, itemId, title }] }]`: only complete boards, you first, then the host, then by name.
- **bracket** — `totalRounds`, `winner` (`{ id, title }`, or `null` if the host revealed before the final), and `rounds` as in `/bracket` with every breakdown.
- **mlt** — `prompts: [{ itemId, text, sortOrder, tallies: [{ targetParticipantId, name, count }], winners: [{ participantId, name }], totalVotes }]` and `leaderboard: [{ participantId, name, wins, isYou }]`. Everyone tied for the most votes wins the prompt.
- **tier** — `consensus: [{ tier, items: [{ itemId, title, average }] }]` (each item's average tier value, S=5…D=1, rounded back to a tier) and `players` like rank, with `placements: [{ itemId, title, tier }]`.

### POST /rooms/:code/reveal

Host only: reveal a `voting` room early (e.g. someone left). **200** `{ "success": true, "status": "revealed" }`. Errors: `403 NOT_CREATOR`, `400 INVALID_STATUS`.

### POST /rooms/:code/next-host — `rank`

Host only, after the reveal: pick who hosts the next round. Omit `nextParticipantId` for a random draw that skips anyone who has hosted this series (then resets, never repeating the current host back-to-back).

```json
{ "creatorVoterId": "uuid", "nextParticipantId": "uuid" }
```

**200** `{ "nextHost": { "participantId": "uuid", "name": "Bob" } }`. Errors: `409 SERIES_CONTINUED` once the next round exists.

## Room codes and expiry

- 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 characters, no `0 O 1 I L`) — about 887 million codes.
- Rooms expire 48 hours after creation and 404 from then on. An hourly cron (`[triggers]` in `wrangler.toml`) deletes expired rooms and their rows, freeing their codes.

## Errors

```json
{ "error": { "code": "ROOM_NOT_FOUND", "message": "Room not found or expired" } }
```

| Code               | Status | Meaning                                              |
| ------------------ | ------ | ---------------------------------------------------- |
| `VALIDATION_ERROR` | 400    | Bad input, or not a participant                      |
| `INVALID_STATUS`   | 400    | Not allowed in the room's current status or mode     |
| `NOT_CREATOR`      | 403    | Host-only action                                     |
| `NOT_NEXT_HOST`    | 403    | Someone else was picked to host the next round       |
| `ROOM_NOT_FOUND`   | 404    | Unknown or expired room                              |
| `SERIES_CONTINUED` | 409    | The next round has already been created              |
| `INTERNAL_ERROR`   | 500    | Server error                                         |

## CORS and limits

- CORS allows any origin (`GET, POST, PATCH, DELETE, OPTIONS`; `Content-Type`). There are no cookies, so this exposes nothing extra.
- There is no rate limiting yet. Candidates if abuse appears: room creation and joins per IP via the Workers rate-limiting binding.
