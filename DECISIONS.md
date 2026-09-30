# Technical Decisions & Rationale

This document captures why each technical decision was made, so future-you (or collaborators) understand the tradeoffs.

## Platform: Expo (React Native)

**Decision**: Build with Expo targeting iOS + Android natively, with web as a bonus output.

**Why**:

- Developer has React/frontend experience — Expo minimizes the learning gap to native
- App store presence is a goal, which rules out a web-only PWA
- A swiping interface is inherently mobile-first — native gesture handling matters
- Expo Router provides file-based routing similar to Next.js
- Single codebase for both platforms

**Alternatives considered**:

- **Next.js PWA**: Faster to ship, better web experience, but no real app store presence without wrapping in Capacitor (adds complexity)
- **React Native CLI (no Expo)**: More control over native modules, but much more setup and config. Expo's managed workflow is better for an MVP
- **Flutter**: Great cross-platform tool, but requires learning Dart. Unnecessary context switch when the developer already knows React

**Risks**: Expo's web output is less polished than a purpose-built web app. If web becomes a primary channel, consider building a separate lightweight frontend.

## Backend: Hono on Cloudflare Workers

**Decision**: Custom REST API using Hono framework deployed to Cloudflare Workers.

**Why**:

- Developer wants to learn backend development and have full control
- Hono has an Express-like API that's immediately familiar to JS/React developers
- Cloudflare Workers deploy globally at the edge — no server management, no cold starts
- Free tier: 100K requests/day — enough for thousands of active users
- Local dev with `wrangler dev` is fast and simple
- Same ecosystem as the database (D1), reducing integration complexity

**Alternatives considered**:

- **Supabase**: Would have been fastest to ship. Provides database + API + auth out of the box. Rejected because the developer wants to learn and own the backend code
- **Express/Fastify on Railway/Fly.io**: Familiar but requires managing a persistent server, which adds operational overhead for a solo developer
- **AWS Lambda + API Gateway**: More powerful but dramatically more complex to configure and deploy

## Database: Cloudflare D1 (SQLite)

**Decision**: Use D1 as the primary database, queried directly from Hono route handlers.

**Why**:

- Lives in the same Cloudflare ecosystem as Workers — no connection pooling, no network latency between compute and data
- SQLite is more than sufficient for the data model (rooms, items, votes)
- Free tier: 5GB storage, 5M reads/day
- Migrations managed through Wrangler CLI
- Zero operational overhead

**Alternatives considered**:

- **Supabase Postgres**: More powerful (full-text search, JSON operators, row-level security), but adds a separate service to manage and introduces network latency from Workers
- **Turso (LibSQL)**: SQLite-based like D1 but with multi-region replication. Good option if D1's limitations become a problem
- **PlanetScale / Neon**: Serverless MySQL/Postgres. Overkill for this data model

**Risks**: D1 is still relatively new in the Cloudflare ecosystem. If you hit limitations (e.g., complex queries, concurrent write throughput), Turso is the easiest migration path since it's also SQLite-compatible.

## No Authentication

**Decision**: No user accounts. Identity is an anonymous UUID stored on-device.

**Why**:

- Removes the single biggest friction point for adoption. A user gets a room code via text, opens the app, and is swiping within seconds
- For a group decision tool used among friends, account permanence doesn't matter
- Dramatically simplifies the backend (no auth middleware, no password hashing, no session management, no email verification)
- Room codes act as access control — you can only participate if you have the code

**Risks**:

- Users can't recover their identity on a new device. Acceptable tradeoff
- A determined user could clear storage and vote twice. For an MVP used among friends, this is a non-issue. If abuse becomes a problem later, add optional lightweight auth (magic link or social login)
- No way to show a user their past rooms. Could address later with optional accounts

## Polling (Not WebSockets)

**Decision**: The waiting screen polls GET /api/rooms/:code/status every 3-5 seconds.

**Why**:

- Dramatically simpler to implement than WebSocket or Server-Sent Events
- Cloudflare Workers don't natively support persistent WebSocket connections in the standard Workers model (you'd need Durable Objects)
- The waiting screen is the only place real-time updates matter, and 3-5 second latency is fine for "waiting for friends to finish swiping"
- Polling a lightweight status endpoint is cheap on Workers

**When to upgrade**: If you add features like live vote counts or real-time result animations, look into Cloudflare Durable Objects for WebSocket support, or add a Supabase Realtime subscription layer.

## Binary Voting (Yes/No Only)

**Decision**: Two options only — swipe right (yes) or swipe left (no). No neutral/skip.

**Why**:

- Keeps the swipe UI dead simple — left or right, that's it
- Forces a decision on every item, which produces cleaner results
- Matches the familiar Tinder mental model exactly
- Adding a third option (swipe up for indifferent?) complicates gesture handling

**Risks**: For large item lists, users may not have a strong opinion on every item. Forced yes/no could add noise to results. Monitor feedback — if users complain, a "skip" option is easy to add later.

## Room Lifecycle: open → voting → revealed

**Decision**: Rooms have three states. `open` = creator is adding items and sharing the code. `voting` = creator has started, swiping is live. `revealed` = enough people have voted, results are visible.

**Why**:

- The creator needs time to add items and share the room code before anyone starts swiping
- Items should be editable (add/remove) while the room is `open`, then locked once voting starts — otherwise votes could be cast on items that later disappear
- Participants who join early see a lobby screen ("Waiting for host to start...") instead of an empty swipe screen
- The creator explicitly starts voting when ready, giving them full control over timing

**Alternatives considered**:

- **Auto-start when first non-creator joins**: Doesn't work — creator may still be adding items
- **Auto-start after N seconds**: Arbitrary and frustrating if the creator isn't done sharing

**Risks**: If the creator never starts, the room is stuck in `open`. Acceptable — rooms expire after 48 hours regardless.

## Auto-Reveal When Every Participant Is Done

**Decision**: Results reveal automatically once every participant who joined the room has finished (with a mode-specific minimum of 2–3 players). The host can also force a reveal from the waiting screen.

**Why**:

- Creates a fun "reveal moment" — results appear simultaneously for everyone
- The original design had the host enter an expected head count up front; migration 0002 replaced it with a participants table, so the room knows exactly who joined instead of relying on a guess
- Force reveal covers the case where someone wanders off

**Risks**: Anyone who joins and then leaves still counts, so they hold up the automatic reveal until the host forces it. There's no kick or leave yet.

## Item Shuffle Per Participant

**Decision**: Items are presented in a deterministic but per-participant random order using their voter ID as a shuffle seed.

**Why**:

- Prevents position bias (first and last items tend to get disproportionate attention)
- Deterministic seed means refreshing the app doesn't change the order
- Different participants see different orders, producing more balanced results

**Implementation note**: Use a simple seeded PRNG (e.g., a function based on the voter ID string) to shuffle the items array client-side after fetching from the API.

## Game Modes Behind One Handler Interface

**Decision**: Each game mode is a `ModeHandler` in `apps/api/src/modes/` (item visibility, setup on start, resume state, progress, results), and the rules that the app also needs (item limits, player minimums, whether suggestions are allowed) live in the `@tot/shared` workspace package.

**Why**:

- With five modes, per-mode `if` chains had spread to ~10 places in the API and ~5 in the app, plus four copies of the auto-reveal query. Adding a mode meant finding all of them
- Routes that every mode shares (`/status`, `/results`, `/start`, `GET /rooms/:code`) now dispatch through the handler and never branch on the mode
- One copy of the rules means the app's "3/12 items" counter and the API's validation can't drift apart
- The shared package ships TypeScript source with no build step: Metro, Wrangler's esbuild, and Vitest all compile it directly

**Alternatives considered**: A published shared-types package with its own build (more moving parts for no gain in a monorepo); keeping the rules duplicated with "keep in sync" comments (that's what drifted).

## Expired Rooms Are Deleted by a Cron

**Decision**: Every request treats a room as gone once `expires_at` passes, and a weekly Cron Trigger deletes expired rooms and all their rows.

**Why**:

- Per-request checks alone left dead rows forever, and since `rooms.code` is `UNIQUE`, a new room that drew a dead room's code failed to insert
- Weekly is plenty for how little the app is used: expiry is already enforced on every request, so the cron only reclaims space and frees codes
- Deletes run in D1 batches of 200 rooms (children first, because D1 enforces foreign keys), each a single transaction, repeated until nothing expired is left
- `expires_at` is compared against a bound ISO timestamp, never SQLite's `datetime('now')`, whose different format made rooms outlive their 48 hours

## Draft Turns Are Enforced by Unique Constraints

**Decision**: In a draft room the turn order is a seating drawn at random when the host starts, and each pick is a row with a global `pick_index` and a normalized `title_key`, both `UNIQUE` per room. Whose turn it is falls out of the pick count and the seating (`seatForPick` in `@tot/shared`); the constraints decide races. Nobody may join once a draft has started.

**Why**:

- Two players tapping "Draft it" at the same moment must not both succeed, and the same entry must not be drafted twice in different spellings of case or spacing. Checking with a SELECT first would leave a window; letting the INSERT fail on `UNIQUE(room_id, pick_index)` or `UNIQUE(room_id, title_key)` closes it, and the route maps the violation to `NOT_YOUR_TURN` or `DUPLICATE_PICK`
- Storing the seating rather than deriving it from join order lets the order be random, so the host has no edge from creating the room, and makes it immune to renames and rejoins
- A latecomer can't be seated without changing everyone else's remaining turns, so joins are refused while voting. That's a rule in `MODE_RULES` (`joinAfterStart`), not a mode check in the join route, so the next turn-based mode gets it for free

**Alternatives considered**: A `current_seat` column on the room updated per pick (a second write that can drift from the picks table); seating latecomers at the end of the order (unfair in a snake draft, and confusing mid-round).

