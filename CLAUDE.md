# This or That (ToT) — Project Context

## What is this?

A mobile app for group decision-making through Tinder-style swiping. Users create "rooms" around a topic (e.g., "Friday dinner"), add options, share a room code with friends, and everyone swipes yes/no on each option. The creator starts voting when ready, and results are revealed once all participants have voted.

## Tech Stack

### Frontend — Expo (React Native)

- **Framework**: Expo SDK (latest stable) with Expo Router for file-based routing
- **Swipe UI**: `react-native-gesture-handler` + `react-native-reanimated` for the card swiping mechanic
- **Targets**: iOS, Android, and web (web is a bonus, not the primary target)
- **State management**: React Context or Zustand — keep it simple, no Redux
- **Styling**: StyleSheet API (React Native standard), no external UI library unless needed

### Backend — Hono on Cloudflare Workers

- **Framework**: Hono (lightweight, Express-like API framework)
- **Runtime**: Cloudflare Workers (edge deployment, no server management)
- **Language**: TypeScript
- **Deployment**: Wrangler CLI (`wrangler dev` for local, `wrangler deploy` for production)

### Database — Cloudflare D1 (SQLite)

- **Type**: Serverless SQLite, lives within the Cloudflare ecosystem
- **Access**: Queried directly from Hono route handlers via the D1 binding
- **Migrations**: Use Wrangler D1 migrations (`wrangler d1 migrations create`)

## Architecture Overview

```
┌─────────────────────┐         ┌──────────────────────────┐
│   Expo App          │  REST   │  Cloudflare Workers      │
│   (iOS/Android/Web) │ ──────> │  Hono API                │
│                     │         │         │                 │
│                     │ <────── │         ▼                 │
│                     │  JSON   │  Cloudflare D1 (SQLite)   │
└─────────────────────┘         └──────────────────────────┘
```

Communication is REST/JSON only. No websockets needed — the app uses polling on the waiting screen.

## Core User Flow

### Creator Flow

1. **Home screen** → Tap "Create a room"
2. **Create room screen** → Enter topic/title, expected participant count (including self), and display name
3. **Add items screen** → Type item titles one at a time, reorder/delete as needed (max 15 items)
4. **Share screen** → 6-character room code displayed with copy + native share button. Creator can still edit items from here.
5. **Start voting** → Creator taps "Start" when ready. Items are locked and participants can begin swiping.
6. **Swipe screen** → Creator swipes on their own items too
7. **Waiting screen** → Polls for completion, shows "X of N done"
8. **Results screen** → Items ranked by yes-percentage

### Participant Flow

1. **Home screen** → Tap "Join a room"
2. **Join screen** → Enter 6-character room code
3. **Display name screen** → Enter a display name (no account needed)
4. **Lobby screen** → If room is still in `open` status, show "Waiting for host to start..." with the room topic
5. **Swipe screen** → Swipe yes/no on each item card, progress indicator shows "3 of 12"
6. **Waiting screen** → Same as creator
7. **Results screen** → Same as creator

## Database Schema

```sql
-- Rooms table
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,           -- UUID
  code TEXT UNIQUE NOT NULL,     -- 6-char uppercase alphanumeric (excludes 0,O,1,I,L)
  topic TEXT NOT NULL,           -- Room topic/title
  expected_count INTEGER NOT NULL, -- Number of expected participants (including creator)
  creator_voter_id TEXT NOT NULL,  -- Anonymous voter ID of the creator
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'voting' | 'revealed'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL         -- Auto-set to created_at + 48 hours
);

-- Items in a room
CREATE TABLE items (
  id TEXT PRIMARY KEY,           -- UUID
  room_id TEXT NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,   -- Creator's original order (used as base for shuffle)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Votes (one per voter per item)
CREATE TABLE votes (
  id TEXT PRIMARY KEY,           -- UUID
  room_id TEXT NOT NULL REFERENCES rooms(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  voter_id TEXT NOT NULL,        -- Anonymous ID from client localStorage/AsyncStorage
  voter_name TEXT NOT NULL,      -- Display name
  vote TEXT NOT NULL,            -- 'yes' | 'no'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, voter_id)     -- One vote per person per item
);

-- Index for fast lookups
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_items_room ON items(room_id);
CREATE INDEX idx_votes_room ON votes(room_id);
CREATE INDEX idx_votes_item ON votes(item_id);
```

## API Endpoints

### POST /api/rooms

Create a new room. Generates a 6-character code.

- **Body**: `{ topic: string, expectedCount: number, creatorVoterId: string, creatorName: string }`
- **Returns**: `{ id, code, topic, expectedCount }`

### POST /api/rooms/:code/items

Add items to a room. Only the room creator can add items. Room must be in `open` status.

- **Body**: `{ items: string[], creatorVoterId: string }`
- **Returns**: `{ items: [{ id, title, sortOrder }], totalItems: number }`

### DELETE /api/rooms/:code/items/:itemId

Delete a single item. Creator only, room must be in `open` status.

- **Query params**: `creatorVoterId` (required)
- **Returns**: `{ success: true, totalItems: number }`

### POST /api/rooms/:code/start

Start voting. Transitions room from `open` to `voting`. Only the room creator can start. Items are locked after this.

- **Body**: `{ creatorVoterId: string }`
- **Returns**: `{ success: true, status: 'voting', itemCount: number }`

### GET /api/rooms/:code

Get room details and items.

- **Returns**: `{ id, code, topic, expectedCount, status, items: [{ id, title }], myVotes: { itemId: vote } }`
- **Query params**: `voterId` (optional) — if provided, includes `myVotes` for resume-after-close
- **Note**: Items are returned in the creator's original sort order. The client shuffles them using the voter's ID as a seed, so order is consistent across refreshes but different per participant.
- When status is `open`, only the creator sees items. Non-creators see an empty items array (lobby screen).

### POST /api/rooms/:code/votes

Submit a single vote (called after each swipe, not batched). Room must be in `voting` status.

- **Body**: `{ itemId: string, voterId: string, voterName: string, vote: 'yes' | 'no' }`
- **Returns**: `{ success: true, progress: { voted, total } }`

### GET /api/rooms/:code/status

Check voting progress.

- **Returns**: `{ expectedCount, completedCount, isRevealed: boolean }`
- A voter is "completed" when they have votes for ALL items in the room.
- `isRevealed` is true when `completedCount >= expectedCount`.

### GET /api/rooms/:code/results

Get final results. Only returns data if the room is revealed.

- **Returns**: `{ revealed: true, results: [{ itemId, title, yesCount, noCount, yesPercentage }] }` sorted by yesPercentage descending
- If not yet revealed: `{ revealed: false, completedCount, expectedCount }`

## Key Design Decisions

### No Authentication

- Users are identified by a random anonymous ID generated on first app launch
- Stored in AsyncStorage (React Native) / localStorage (web)
- Display names are entered per-room, not globally
- No account creation, no login, no password recovery
- Tradeoff: users can't recover their identity across devices. Acceptable for a group decision tool.

### Room Codes

- 6 characters, uppercase alphanumeric
- Excludes ambiguous characters: 0, O, 1, I, L (uses: ABCDEFGHJKMNPQRSTUVWXYZ23456789)
- This gives ~27^6 ≈ 387 million possible codes — more than enough
- Codes are unique but rooms expire after 48 hours, so codes can be recycled

### Item Order Shuffling

- The API returns items in the creator's original sort order
- The client shuffles items per-participant using their voter ID as a seed for a deterministic shuffle
- This avoids position bias while keeping the API stateless
- Creator sees items in their original order during the creation phase, shuffled during swiping

### Vote Persistence

- Each vote is saved immediately on swipe (not batched at the end)
- If a user closes and reopens the app, they resume where they left off
- The GET /api/rooms/:code endpoint should also return which items the voter has already voted on

### Results Reveal

- Results auto-reveal when `completedCount >= expectedCount`
- The waiting screen polls GET /api/rooms/:code/status every 3-5 seconds
- Once revealed, results are visible to all participants via the results endpoint

### Room Expiration

- Rooms expire 48 hours after creation
- Expired rooms return 404 on all endpoints
- Implement via a scheduled Cloudflare Worker (cron trigger) that deletes expired rooms, or simply check expiry on each request

### Item Limits

- Maximum 15 items per room
- Enforced both client-side (UI) and server-side (API validation)

## Project Structure

```
this-or-that/
├── apps/
│   ├── mobile/                    # Expo app
│   │   ├── app/                   # Expo Router file-based routes
│   │   │   ├── _layout.tsx        # Root layout
│   │   │   ├── index.tsx          # Home screen (Create / Join)
│   │   │   ├── create/
│   │   │   │   ├── index.tsx      # Create room form
│   │   │   │   ├── items.tsx      # Add items screen
│   │   │   │   └── share.tsx      # Show room code
│   │   │   ├── join/
│   │   │   │   ├── index.tsx      # Enter room code
│   │   │   │   └── name.tsx       # Enter display name
│   │   │   ├── room/
│   │   │   │   ├── [code]/
│   │   │   │   │   ├── lobby.tsx  # Waiting for host to start voting
│   │   │   │   │   ├── swipe.tsx  # Swiping screen
│   │   │   │   │   ├── waiting.tsx # Waiting for others
│   │   │   │   │   └── results.tsx # Results screen
│   │   ├── components/
│   │   │   ├── SwipeCard.tsx      # The swipeable card component
│   │   │   ├── ItemList.tsx       # Editable item list for creation
│   │   │   ├── RoomCodeInput.tsx  # 6-character code input
│   │   │   └── ResultsBar.tsx     # Horizontal bar showing yes/no ratio
│   │   ├── lib/
│   │   │   ├── api.ts             # API client (fetch wrapper)
│   │   │   ├── storage.ts         # AsyncStorage helpers (voter ID)
│   │   │   └── shuffle.ts         # Seeded shuffle function
│   │   ├── app.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── api/                       # Hono + Cloudflare Workers
│       ├── src/
│       │   ├── index.ts           # Hono app entry point, route registration
│       │   ├── routes/
│       │   │   ├── rooms.ts       # POST /rooms, GET /rooms/:code, POST /rooms/:code/items, DELETE /rooms/:code/items/:itemId, POST /rooms/:code/start
│       │   │   ├── votes.ts       # POST /rooms/:code/votes
│       │   │   └── results.ts     # GET /rooms/:code/status, GET /rooms/:code/results
│       │   ├── db/
│       │   │   ├── schema.sql     # D1 table definitions
│       │   │   └── queries.ts     # Typed query helpers
│       │   ├── lib/
│       │   │   ├── codes.ts       # Room code generation
│       │   │   └── validation.ts  # Input validation helpers
│       │   └── types.ts           # Shared TypeScript types
│       ├── wrangler.toml          # Cloudflare Workers config + D1 binding
│       ├── package.json
│       └── tsconfig.json
│
├── packages/                      # Shared code (optional, for later)
│   └── shared-types/              # Types shared between mobile and API
│
├── package.json                   # Monorepo root (npm workspaces)
├── CLAUDE.md                      # This file
└── README.md
```

## Environment & Tooling

- **Monorepo**: npm workspaces (keep it simple, no Turborepo needed yet)
- **Language**: TypeScript everywhere
- **Linting**: ESLint + Prettier
- **Testing**: Vitest for the API, React Native Testing Library for the app (add after MVP)
- **Local dev**: `wrangler dev` for the API, `npx expo start` for the app

## Phase 2 Ideas (NOT for MVP)

These are explicitly out of scope for the initial build:

- AI-generated item lists (e.g., "suggest restaurants near me")
- Real-time updates via websockets or Supabase subscriptions (currently using polling)
- User accounts and room history
- Rich items with images and descriptions
- Tie-breaker rounds
- Custom room expiry times
- Deep links for room joining (e.g., thisorthat.app/join/ABC123)
- Web-optimized PWA as a separate frontend

## Development Order

Suggested build sequence for the MVP:

### 1. API first

1. Scaffold the Hono project with Wrangler
2. Create D1 database and run schema migration
3. Implement POST /api/rooms (room + code generation)
4. Implement POST /api/rooms/:code/items (add items to room)
5. Implement POST /api/rooms/:code/start (begin voting)
6. Implement GET /api/rooms/:code
7. Implement POST /api/rooms/:code/votes
8. Implement GET /api/rooms/:code/status
9. Implement GET /api/rooms/:code/results
10. Test all endpoints with curl or a REST client

### 2. Expo app — screens

1. Scaffold Expo project with Expo Router
2. Home screen (two buttons)
3. Create room flow (form → add items → share code)
4. Join room flow (code input → display name)
5. Swipe screen (core mechanic — spend the most time here)
6. Waiting screen (polling)
7. Results screen

### 3. Integration

1. Connect Expo app to live API
2. Test full flow end-to-end on iOS simulator
3. Test on Android emulator
4. Test on physical devices

### 4. Polish & Ship

1. Error handling and edge cases
2. Loading states and skeleton screens
3. Deploy API to Cloudflare Workers (production)
4. Build with EAS and submit to App Store / Play Store
