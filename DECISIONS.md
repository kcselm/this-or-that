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

## Auto-Reveal at Participant Count

**Decision**: Results are automatically revealed when the number of completed voters equals the expected participant count set by the room creator.

**Why**:

- Creates a fun "reveal moment" — results appear simultaneously for everyone
- Simpler than requiring the creator to manually trigger reveal
- The expected count is set at room creation, so the system knows when everyone is done

**Risks**: If someone never votes, results are stuck. Mitigation: the creator could be given a manual "reveal anyway" button on the waiting screen as a fallback. This is a minor enhancement that can be added post-MVP.

## Item Shuffle Per Participant

**Decision**: Items are presented in a deterministic but per-participant random order using their voter ID as a shuffle seed.

**Why**:

- Prevents position bias (first and last items tend to get disproportionate attention)
- Deterministic seed means refreshing the app doesn't change the order
- Different participants see different orders, producing more balanced results

**Implementation note**: Use a simple seeded PRNG (e.g., a function based on the voter ID string) to shuffle the items array client-side after fetching from the API.
