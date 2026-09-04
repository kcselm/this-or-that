# This or That

Group decision-making through Tinder-style swiping. Create a room around a topic, share a 6-character code with friends, and everyone votes — no accounts, no logins. When everyone's done, the results are revealed.

Built as an [Expo](https://expo.dev) (React Native) app talking to a [Hono](https://hono.dev) API running on [Cloudflare Workers](https://developers.cloudflare.com/workers/), backed by [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite). Communication is plain REST/JSON — no websockets; the app polls while waiting.

## Game modes

The room creator picks a mode when creating a room:

| Mode | How it works |
| --- | --- |
| **♥ Swipe Vote** | Add a list of options. Everyone swipes yes/no on each card. Ranked by yes-percentage. |
| **◎ Blind Rank** | Pick 5 items. Players rank them one at a time without knowing what's coming next. |
| **⚔ Bracket** | Items face off in a tournament. Each round everyone votes on the matchups until a winner emerges. |
| **★ Most Likely To** | Pick prompts like *"most likely to ghost the group chat."* For each one, vote on the person in the room who fits best. |

## How it works

1. **Create** a room — choose a mode, a topic, how many people to expect, and your display name.
2. **Add items** (or prompts) — up to 15.
3. **Share** the 6-character room code. Friends join with just the code and a display name.
4. **Start** when everyone's in. Items lock and voting begins.
5. **Vote** — each person swipes/ranks/picks. Progress is saved after every action, so you can close the app and resume.
6. **Reveal** — once everyone has finished, results are revealed to all participants.

No authentication: each device gets an anonymous ID stored locally. Room codes use an unambiguous alphabet (no `0/O/1/I/L`) and rooms expire after 48 hours.

## Tech stack

- **Mobile** — Expo SDK 54, Expo Router (file-based routing), React Native 0.81, `react-native-gesture-handler` + `react-native-reanimated` for the swipe mechanic. Targets iOS, Android, and web.
- **API** — Hono on Cloudflare Workers (TypeScript), deployed with Wrangler.
- **Database** — Cloudflare D1 (serverless SQLite), queried directly from route handlers.
- **Monorepo** — npm workspaces.

## Project structure

```
this-or-that/
├── apps/
│   ├── mobile/              # Expo app
│   │   ├── app/             # Expo Router routes
│   │   │   ├── index.tsx    # Home (Create / Join)
│   │   │   ├── create/      # mode → topic → items → share
│   │   │   ├── join/        # code → name
│   │   │   └── room/[code]/ # lobby, swipe, rank, bracket, mlt, waiting, results
│   │   ├── components/      # SwipeCard, ItemList, ResultsBar, ...
│   │   └── lib/             # api client, storage, shuffle, theme
│   └── api/                 # Hono + Cloudflare Workers
│       ├── src/
│       │   ├── index.ts     # App entry + route registration
│       │   ├── routes/      # rooms, votes, results, rankings, bracket, mlt
│       │   ├── db/          # schema.sql + typed query helpers
│       │   └── lib/         # code generation, validation, mlt prompts
│       └── wrangler.toml    # Workers config + D1 binding
├── CLAUDE.md                # Full project spec & conventions
├── APISPEC.md               # REST API reference
└── DECISIONS.md             # Technical decisions & rationale
```

## Getting started

Requires Node.js 18+ and npm. Install everything from the repo root:

```bash
npm install
```

### Run the API (Cloudflare Workers)

```bash
cd apps/api

# First-time setup: create the D1 database and apply the schema
npx wrangler d1 create tot-db          # then paste the database_id into wrangler.toml
npx wrangler d1 execute tot-db --local --file=src/db/schema.sql

npm run dev                            # local Worker at http://localhost:8787
```

`npm run deploy` from this directory tests, migrates, then deploys the API.
See [Deploying](#deploying) for the full stack.

### Run the mobile app

```bash
cd apps/mobile
npm start                              # then press i / a / w for iOS, Android, web
```

Point the app at your API by setting the API base URL (see `apps/mobile/lib/api.ts`).

## Deploying

Both halves of the stack live on Cloudflare and deploy from the repo root:

```bash
npm run deploy          # API + web frontend
npm run deploy:api      # API only
npm run deploy:web      # web frontend only
```

| Target | URL | Config |
| --- | --- | --- |
| API (Hono Worker + D1) | https://tot-api.kcselm93.workers.dev | `apps/api/wrangler.toml` |
| Web app (static assets Worker) | https://tot-web.kcselm93.workers.dev | `apps/mobile/wrangler.jsonc` |

`deploy:api` runs the test suite, applies any pending D1 migrations to the remote
database, then deploys the Worker — in that order, so the schema is always ahead of
the code that depends on it. Use `npm run deploy:worker -w tot-api` to push code
without the test/migration steps.

`deploy:web` runs `expo export --platform web` and uploads `dist/` as a static-assets
Worker. Expo exports dynamic routes as literal `room/[code]/lobby.html` files, so the
Worker is configured with `not_found_handling: "single-page-application"` — deep links
like `/room/ABC123/lobby` fall back to `index.html` and expo-router resolves them
client-side.

Native iOS/Android builds are not automated; the app is not published to the app stores.

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — full product spec, data model, and conventions.
- **[APISPEC.md](./APISPEC.md)** — endpoint-by-endpoint REST reference.
- **[DECISIONS.md](./DECISIONS.md)** — why each technical choice was made.

## Status

This is an MVP / hobby project. Not currently published to the app stores.
