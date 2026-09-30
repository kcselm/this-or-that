# This or That (ToT) — Project Context

## What is this?

A mobile app for group decisions and party games. A host creates a **room** around a topic ("Friday dinner"), picks a **game mode**, adds items, and shares a 6-character room code. Friends join with the code and a display name — no accounts. The host starts the game, everyone plays, and results are revealed once everyone has finished.

## Game modes

| Mode      | Id        | How it plays                                                                                                                    | Items          | Players to start |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------- |
| Swipe Vote     | `vote`    | Everyone swipes yes/no on every item. Ranked by yes-percentage. Participants may suggest items if the host allows it.           | 2–15           | 1                |
| Blind Rank     | `rank`    | Items are dealt one at a time in a shared random order; each player locks each into a rank slot 1–5 without seeing what's next. | exactly 5      | 1                |
| Bracket        | `bracket` | Items face off head-to-head. Each round closes when everyone has voted; odd fields get a rolling bye.                            | 4–16           | 1                |
| Most Likely To | `mlt`     | For each prompt, everyone votes for the player who fits best. Ties share the win.                                              | 3–15 prompts   | 3                |
| Tier List      | `tier`    | Each player sorts every item into S–D and locks the board in one go. Reveal shows a consensus board plus every player's board.   | 3–12           | 1                |
| Draft          | `draft`   | Players take turns typing picks for the topic (snake or circle order, drawn at random). No entry can be taken twice. Reveal shows every player's list. | none (players draft) | 2           |

Automatic reveal needs at least 2 players (3 for Most Likely To). **The rules above live in `packages/shared/src/modes.ts` (`MODE_RULES`) — that file is the source of truth; the API enforces it and the app mirrors it.**

Blind Rank rooms can **keep playing**: after the reveal the host picks the next host (or draws randomly), that player creates the next round, and everyone is moved into it. Rounds are chained into a _series_ (`series_id`, `round_number`, `next_room_id`).

## Tech stack

- **App** — Expo SDK 54 (React Native 0.81, React 19), Expo Router (typed routes), `react-native-gesture-handler` + `react-native-reanimated` for swipe/drag. Targets iOS, Android, and web. Local state per screen plus AsyncStorage; no global store. StyleSheet + tokens in `lib/theme.ts`.
- **API** — Hono on Cloudflare Workers (TypeScript), deployed with Wrangler. A weekly cron deletes expired rooms.
- **Database** — Cloudflare D1 (SQLite), queried directly with prepared statements. Schema changes are numbered migrations in `apps/api/migrations/`.
- **Shared** — `@tot/shared` workspace package (TypeScript source, no build step): modes and rules, tiers, bracket shape, draft turn order.
- **Monorepo** — npm workspaces: `apps/*`, `packages/*`.

Communication is REST/JSON only. Screens that wait on other players poll (`lib/usePolling.ts`, which pauses while the app is backgrounded).

## Room lifecycle

```
open ──start──▶ voting ──everyone done / host reveals──▶ revealed
  │                │
  └──close─────────┴──▶ closed
```

- `open`: host edits items and settings; people join. Only the host sees the items, unless it's a swipe-vote room with suggestions on.
- `voting`: items are locked. Joining is still allowed, except in draft rooms, whose turn order is fixed at start (`MODE_RULES.joinAfterStart`). Everyone sees the items, except in blind rank and bracket rooms, where the server deals them out (`/next-item`, `/bracket`) so nobody can peek ahead. Draft rooms have no items; the board lives at `/draft` and picks go to `/picks`.
- `revealed`: results are visible to anyone with the code. Can't be closed (that would hide the results).
- `closed`: the host ended the room early; nothing is shown.
- Rooms **expire 48 hours after creation** (`expires_at`, an ISO string). Expired rooms 404 everywhere and are deleted by the weekly cron (`apps/api/src/lib/cleanup.ts`).

## Identity and privacy

- Each device has a random **voter id** (UUID) — the only credential in the system. Native: AsyncStorage. Web: `sessionStorage`, so each tab is a separate player (handy for testing, but closing the tab loses your identity).
- **A voter id must never appear in an API response.** Participants are exposed by their public `participantId`. Tests enforce this (`test/*-privacy.test.ts`, `expectNoVoterIds`).
- The host proves they're the host by sending `creatorVoterId`. Every submission checks the voter is a participant of the room.
- Display names are per room, 1–30 characters after trimming.

## Architecture

### API (`apps/api`)

- `src/index.ts` — Hono app, CORS, error handler, route registration, and the `scheduled` cron handler.
- `src/routes/` — HTTP handlers. `rooms.ts` (create, items, start, get, join, participants, settings, close, next-host), `results.ts` (status, results, force reveal), and one submission route per mode: `votes.ts`, `rankings.ts`, `bracket.ts`, `mlt.ts`, `tiers.ts`, `draft.ts`.
- `src/modes/` — **everything that differs between modes**, one `ModeHandler` per mode (`types.ts` documents the interface): item visibility, setup on start, resume state, progress, results. `index.ts` has the registry, `maybeReveal`, and the wrong-endpoint error. Shared routes call `modeHandler(room.mode)` and never branch on the mode themselves.
- `src/db/queries.ts` — row types and query helpers. `schema.sql` mirrors the migrations for reference.
- `src/lib/` — room codes, validation responses, participant helpers, series helper, cleanup.

### App (`apps/mobile`)

- `app/` — Expo Router screens: home, `create/` (mode → topic → share), `join/` (code → name), `room/[code]/` (lobby, one play screen per mode, waiting, round-reveal, results), `lists/` (saved item lists), `history.tsx` (past results kept on device for 30 days).
- `lib/modes.ts` — which screen a room belongs on (`roomScreen`, `playScreen`), mode titles and labels, and why the host can't start yet (`startBlocker`).
- `lib/api.ts` — typed fetch client. Results are a union discriminated on `mode`.
- `lib/storage.ts` — voter id, the active room (rejoin banner), tier drafts, saved lists, saved results.
- `components/results/` — one results view per mode; `components/share/` — pieces of the host's setup screen.

### Adding a game mode

1. Add the id and its `MODE_RULES` entry in `packages/shared/src/modes.ts`.
2. Migration for any new tables (with `room_id`), and add them to `CHILD_TABLES` in `src/lib/cleanup.ts`.
3. A `ModeHandler` in `apps/api/src/modes/` registered in `modes/index.ts`, plus a submission route that calls `maybeReveal`.
4. In the app: a play screen under `app/room/[code]/`, an entry in `PLAY_SCREENS`/labels in `lib/modes.ts`, a results component, and the result type in `lib/api.ts`. TypeScript's exhaustiveness checks point at anything missed.

## Commands

From the repo root:

```bash
npm install          # all workspaces
npm run check        # format check, lint, typecheck, and every test suite (what CI runs)
npm test             # all test suites
npm run typecheck
npm run lint
npm run format       # Prettier --write
```

Per app:

```bash
# API — http://localhost:8787
cd apps/api
npm run migrate:local   # apply migrations to the local D1
npm run dev

# App — against the local API
cd apps/mobile
EXPO_PUBLIC_API_BASE=http://localhost:8787/api npx expo start
```

## Testing

- **API**: Vitest with `@cloudflare/vitest-pool-workers` runs the real Worker against a real local D1 with all migrations applied (`apps/api/test/`). Helpers in `test/helpers.ts`. Covers every mode's game through to the reveal, privacy, membership, races, series, expiry and cleanup.
- **App**: Vitest over pure modules in `lib/` (`lib/*.test.ts`). Screens are checked by running the app.
- **Shared**: Vitest in `packages/shared/src/*.test.ts`.
- Known gaps are recorded as `it.todo` in `apps/api/test/game-flow.test.ts`.

## Deployment

- `npm run deploy:api` — tests, applies remote D1 migrations, then deploys the Worker (migrations land first, so each must be compatible with the running code).
- `npm run deploy:web` — `expo export --platform web`, then a static-assets Worker (`apps/mobile/wrangler.jsonc`) with SPA fallback so deep links resolve.
- Native builds aren't automated yet (no `eas.json`); the app isn't in the stores.

## Conventions

- TypeScript strict everywhere. Prettier (100 cols) and ESLint run in CI.
- API errors are `{ error: { code, message } }` via `src/lib/validation.ts`. State changes that can race use conditional updates (`... WHERE status = 'voting'`) or UNIQUE constraints, never read-then-write.
- Comments explain _why_; commit messages follow Conventional Commits (`feat(api): …`, `fix(mobile): …`).
- `APISPEC.md` is the endpoint reference; `DECISIONS.md` records why things are the way they are. Design specs and implementation plans for larger features live in `docs/superpowers/`.
