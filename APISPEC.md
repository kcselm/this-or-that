# API Specification

Base URL: `https://api.thisorthat.app` (or your Cloudflare Workers custom domain)

All requests and responses use JSON. All timestamps are ISO 8601 UTC.

## Endpoints

### POST /api/rooms

Create a new room (without items — items are added separately).

**Request body:**

```json
{
  "topic": "Friday dinner",
  "expectedCount": 5,
  "creatorVoterId": "a1b2c3d4-uuid",
  "creatorName": "Alex"
}
```

**Validation rules:**

- `topic`: required, string, 1-100 characters
- `expectedCount`: required, integer, 2-20
- `creatorVoterId`: required, string (UUID format)
- `creatorName`: required, string, 1-30 characters

**Response (201):**

```json
{
  "id": "room-uuid",
  "code": "HK7M3N",
  "topic": "Friday dinner",
  "expectedCount": 5,
  "createdAt": "2026-04-12T10:00:00Z",
  "expiresAt": "2026-04-14T10:00:00Z"
}
```

**Errors:**

- 400: Validation error (missing fields, etc.)

---

### POST /api/rooms/:code/items

Add items to a room. Only the room creator can add items. Room must be in `open` status (items are locked once voting begins).

Items can be added one at a time or in bulk. Called from the "Add items" screen.

**Request body:**

```json
{
  "items": ["Thai place", "Pizza", "Sushi", "Tacos", "Burgers"],
  "creatorVoterId": "a1b2c3d4-uuid"
}
```

**Validation rules:**

- `items`: required, array of strings, 1-15 items, each 1-100 characters
- `creatorVoterId`: required, must match the room's creator
- Total items in the room must not exceed 15 after adding
- Room must be in `open` status

**Response (201):**

```json
{
  "items": [
    { "id": "item-uuid-1", "title": "Thai place", "sortOrder": 0 },
    { "id": "item-uuid-2", "title": "Pizza", "sortOrder": 1 },
    { "id": "item-uuid-3", "title": "Sushi", "sortOrder": 2 },
    { "id": "item-uuid-4", "title": "Tacos", "sortOrder": 3 },
    { "id": "item-uuid-5", "title": "Burgers", "sortOrder": 4 }
  ],
  "totalItems": 5
}
```

**Errors:**

- 400: Validation error (too many items, empty titles, room not in `open` status, etc.)
- 403: Caller is not the room creator
- 404: Room not found or expired

---

### DELETE /api/rooms/:code/items/:itemId

Delete a single item from a room. Only the room creator can delete items. Room must be in `open` status.

**Query params:**

- `creatorVoterId` (required): Must match the room's creator

**Response (200):**

```json
{
  "success": true,
  "totalItems": 4
}
```

**Errors:**

- 400: Room not in `open` status
- 403: Caller is not the room creator
- 404: Room, or item, not found or expired

---

### POST /api/rooms/:code/start

Transition a room from `open` to `voting`. Only the room creator can start voting. After this, items are locked and participants can begin swiping.

**Request body:**

```json
{
  "creatorVoterId": "a1b2c3d4-uuid"
}
```

**Validation rules:**

- `creatorVoterId`: required, must match the room's creator
- Room must be in `open` status
- Room must have at least 2 items

**Response (200):**

```json
{
  "success": true,
  "status": "voting",
  "itemCount": 5
}
```

**Errors:**

- 400: Room not in `open` status, or fewer than 2 items
- 403: Caller is not the room creator
- 404: Room not found or expired

---

### GET /api/rooms/:code

Fetch room details and items. Optionally accepts a voter ID to include their existing votes.

**Query params:**

- `voterId` (optional): If provided, response includes which items this voter has already voted on

**Response (200):**

```json
{
  "id": "room-uuid",
  "code": "HK7M3N",
  "topic": "Friday dinner",
  "expectedCount": 5,
  "status": "voting",
  "items": [
    { "id": "item-uuid-1", "title": "Thai place" },
    { "id": "item-uuid-2", "title": "Pizza" },
    { "id": "item-uuid-3", "title": "Sushi" },
    { "id": "item-uuid-4", "title": "Tacos" },
    { "id": "item-uuid-5", "title": "Burgers" }
  ],
  "myVotes": {
    "item-uuid-1": "yes",
    "item-uuid-3": "no"
  }
}
```

Notes:

- `status` is one of: `open` (creator adding items), `voting` (swiping in progress), `revealed` (results visible).
- When status is `open`, only the creator sees `items`. Non-creators see an empty items array and know to show a "waiting for host" lobby screen.
- When status is `voting` or `revealed`, all participants see items.
- `myVotes` is only present if `voterId` query param is provided. It's a map of itemId → vote for items the voter has already voted on. This enables resume-after-close.
- Items are returned in the creator's original sort order. The client is responsible for shuffling based on the voter's ID.

**Errors:**

- 404: Room not found or expired

---

### POST /api/rooms/:code/votes

Submit a single vote. Called once per swipe (not batched). Room must be in `voting` status.

**Request body:**

```json
{
  "itemId": "item-uuid-1",
  "voterId": "a1b2c3d4-uuid",
  "voterName": "Jordan",
  "vote": "yes"
}
```

**Validation rules:**

- `itemId`: required, must belong to this room
- `voterId`: required, string
- `voterName`: required, string, 1-30 characters
- `vote`: required, "yes" or "no"
- Room must be in `voting` status

**Response (201):**

```json
{
  "success": true,
  "progress": {
    "voted": 3,
    "total": 5
  }
}
```

`progress` shows how many items this voter has now voted on out of the total items in the room. This drives the "3 of 5" progress indicator on the swipe screen.

**Errors:**

- 404: Room not found or expired
- 400: Invalid item ID, missing fields, room not in `voting` status
- If the voter has already voted on this item, the existing vote is updated (upsert behavior). This makes the endpoint resilient to network retries and simplifies the client.

---

### GET /api/rooms/:code/status

Check overall voting progress. Used by the waiting screen for polling.

**Response (200):**

```json
{
  "expectedCount": 5,
  "completedCount": 3,
  "isRevealed": false,
  "voters": [
    { "name": "Alex", "completed": true },
    { "name": "Jordan", "completed": true },
    { "name": "Sam", "completed": true },
    { "name": "Riley", "completed": false }
  ]
}
```

Notes:

- A voter is "completed" when they have voted on ALL items in the room.
- `voters` only includes people who have cast at least one vote.
- `isRevealed` becomes true when `completedCount >= expectedCount`.
- The `voters` list lets the waiting screen show "Alex ✓, Jordan ✓, Sam ✓, Riley is still swiping..."

**Errors:**

- 404: Room not found or expired

---

### GET /api/rooms/:code/results

Get final ranked results. Only returns full data if voting is complete.

**Response when revealed (200):**

```json
{
  "revealed": true,
  "topic": "Friday dinner",
  "totalVoters": 5,
  "results": [
    {
      "itemId": "item-uuid-3",
      "title": "Sushi",
      "yesCount": 5,
      "noCount": 0,
      "yesPercentage": 100
    },
    {
      "itemId": "item-uuid-1",
      "title": "Thai place",
      "yesCount": 4,
      "noCount": 1,
      "yesPercentage": 80
    },
    {
      "itemId": "item-uuid-4",
      "title": "Tacos",
      "yesCount": 3,
      "noCount": 2,
      "yesPercentage": 60
    },
    {
      "itemId": "item-uuid-2",
      "title": "Pizza",
      "yesCount": 2,
      "noCount": 3,
      "yesPercentage": 40
    },
    {
      "itemId": "item-uuid-5",
      "title": "Burgers",
      "yesCount": 1,
      "noCount": 4,
      "yesPercentage": 20
    }
  ]
}
```

**Response when not yet revealed (200):**

```json
{
  "revealed": false,
  "completedCount": 3,
  "expectedCount": 5
}
```

**Errors:**

- 404: Room not found or expired

---

## Room Code Generation

Characters used: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (27 characters)

- Excludes: 0, O, 1, I, L (commonly confused)
- Always uppercase
- 6 characters long
- Generated server-side, checked for uniqueness against existing non-expired rooms

## Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "Room not found or expired"
  }
}
```

Error codes:

- `VALIDATION_ERROR`: Invalid input (400)
- `ROOM_NOT_FOUND`: Room doesn't exist or has expired (404)
- `ROOM_EXPIRED`: Room has passed its expiry time (410)
- `NOT_CREATOR`: Caller is not the room creator (403)
- `INVALID_STATUS`: Action not allowed in current room status (400)
- `INTERNAL_ERROR`: Server error (500)

## Rate Limiting

Cloudflare Workers has built-in rate limiting. Suggested limits:

- POST /api/rooms: 10/minute per IP (prevent room spam)
- POST /api/rooms/:code/votes: 60/minute per IP (generous to allow fast swiping)
- GET endpoints: 120/minute per IP (polling needs headroom)

## CORS

The API must return appropriate CORS headers for the Expo web build:

- `Access-Control-Allow-Origin: *` (for MVP; tighten in production)
- `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`
