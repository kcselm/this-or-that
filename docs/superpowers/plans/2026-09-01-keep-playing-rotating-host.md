# Keep Playing with a Rotating Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Blind Rank round is revealed, the host picks the next host (by name or no-repeat random), that person creates a new category, and the whole group auto-flows into the next round — implemented as a chain of successor rooms ("series").

**Architecture:** Each round is a new room linked to the previous via four new nullable columns on `rooms` (`series_id`, `round_number`, `next_host_voter_id`, `next_room_id`). One new endpoint picks the next host; `POST /api/rooms` learns an optional `previousRoomCode`; `GET /status` and `GET /rooms/:code` expose `nextHost`/`nextRoomCode`/`roundNumber`. The mobile results screen polls status and auto-joins the successor. No submission table, status-ladder, or host-check changes anywhere.

**Tech Stack:** Hono on Cloudflare Workers + D1 (SQLite), Vitest with `@cloudflare/vitest-plugin`, Expo (React Native) + Expo Router.

**Spec:** `docs/superpowers/specs/2026-09-01-keep-playing-rotating-host-design.md`

## Global Constraints

- `voter_id` values are credentials and must NEVER appear in any API response. Clients see only public `participantId`s. Every new response gets an `expectNoVoterIds` test.
- New error codes: `NOT_NEXT_HOST` (HTTP 403), `SERIES_CONTINUED` (HTTP 409). All other errors reuse the existing `notFound()` / `notCreator()` / `invalidStatus()` / `validationError()` helpers from `apps/api/src/lib/validation.ts`.
- The feature is gated to `mode = 'rank'` rooms. Vote/bracket/mlt/tier behavior must not change (`/status` for those modes returns exactly its current shape).
- No new dependencies, in either workspace.
- D1 tables have no CHECK constraints (app-enforced values); follow that convention.
- Migration files are sequential: the new one is `0009_room_series.sql`. `apps/api/src/db/schema.sql` mirrors migrations and must be updated in the same commit.
- API tests live in `apps/api/test/*.test.ts`, run with `npm test` inside `apps/api` (vitest + miniflare; migrations auto-applied by `test/apply-migrations.ts`). Shared test helpers go in `apps/api/test/helpers.ts`.
- Mobile has no unit-test harness; each mobile task is verified with `npx tsc --noEmit` in `apps/mobile` plus the manual pass in the final task.
- All commits are made from the repo root `C:\Users\kcsel\repo\this-or-that`.

---

## File Structure

**API**
- `apps/api/migrations/0009_room_series.sql` — new: four columns + index on `rooms`.
- `apps/api/src/db/schema.sql` — mirror the migration.
- `apps/api/src/db/queries.ts` — extend `Room` type; add `getSeriesHostVoterIds`, `getLatestSeriesRoom`.
- `apps/api/src/routes/rooms.ts` — new `POST /:code/next-host`; extend `POST /` (previousRoomCode) and `GET /:code` (nextRoomCode, roundNumber).
- `apps/api/src/routes/results.ts` — extend `GET /:code/status` for rank rooms.
- `apps/api/test/helpers.ts` — add `reveal`, `revealedRankRoom`, `pickNextHost`, `createNextRound`, `addItemsAs`, `startAs`.
- `apps/api/test/series.test.ts` — new: all series tests.

**Mobile**
- `apps/mobile/lib/api.ts` — `pickNextHost()`, extended types, friendly messages.
- `apps/mobile/app/room/[code]/results.tsx` — keep-playing UI, status polling, auto-join.
- `apps/mobile/app/create/index.tsx` — `previousRoomCode` support.
- `apps/mobile/app/join/name.tsx` — forward old codes to the newest round.
- `apps/mobile/app/room/[code]/lobby.tsx` — "ROUND N" badge.
- `apps/mobile/app/room/[code]/waiting.tsx` — "Round N" caption.

---

### Task 1: Migration + schema mirror + Room type

**Files:**
- Create: `apps/api/migrations/0009_room_series.sql`
- Modify: `apps/api/src/db/schema.sql` (rooms block, lines 2–12)
- Modify: `apps/api/src/db/queries.ts:1-11` (`Room` type)
- Test: `apps/api/test/series.test.ts` (new file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `rooms.series_id TEXT NULL`, `rooms.round_number INTEGER NOT NULL DEFAULT 1`, `rooms.next_host_voter_id TEXT NULL`, `rooms.next_room_id TEXT NULL`; `Room` type fields `series_id: string | null`, `round_number: number`, `next_host_voter_id: string | null`, `next_room_id: string | null`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/series.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { createRoom } from "./helpers";

describe("room series schema", () => {
  it("a new room is round 1 of no series", async () => {
    const { roomId } = await createRoom("rank");
    const row = await env.DB.prepare(
      "SELECT series_id, round_number, next_host_voter_id, next_room_id FROM rooms WHERE id = ?"
    )
      .bind(roomId)
      .first<any>();
    expect(row).toEqual({
      series_id: null,
      round_number: 1,
      next_host_voter_id: null,
      next_room_id: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- series`
Expected: FAIL — `no such column: series_id`.

- [ ] **Step 3: Write the migration**

Create `apps/api/migrations/0009_room_series.sql`:

```sql
-- Room series: chains successor rooms for "keep playing" multi-round play.
-- series_id = id of the first room in the chain (NULL until/unless the room
-- is part of a series). next_host_voter_id is a credential — never expose it.
ALTER TABLE rooms ADD COLUMN series_id TEXT;
ALTER TABLE rooms ADD COLUMN round_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN next_host_voter_id TEXT;
ALTER TABLE rooms ADD COLUMN next_room_id TEXT;

CREATE INDEX idx_rooms_series ON rooms(series_id);
```

Mirror in `apps/api/src/db/schema.sql`: add the same four columns to the `rooms` CREATE TABLE block (as column definitions, matching the existing style) and add `CREATE INDEX idx_rooms_series ON rooms(series_id);` next to the other room indexes.

Update the `Room` type in `apps/api/src/db/queries.ts` (it currently ends at `expires_at: string;`):

```ts
export type Room = {
  id: string;
  code: string;
  topic: string;
  creator_voter_id: string;
  status: "open" | "voting" | "revealed" | "closed";
  allow_suggestions: number;
  mode: "vote" | "rank" | "bracket" | "mlt" | "tier";
  created_at: string;
  expires_at: string;
  series_id: string | null;
  round_number: number;
  next_host_voter_id: string | null;
  next_room_id: string | null;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `apps/api`): `npm test`
Expected: all tests PASS (the new one plus the existing five suites).

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/0009_room_series.sql apps/api/src/db/schema.sql apps/api/src/db/queries.ts apps/api/test/series.test.ts
git commit -m "feat(api): add room series columns for multi-round play"
```

---

### Task 2: `POST /api/rooms/:code/next-host`

**Files:**
- Modify: `apps/api/src/routes/rooms.ts` (imports at top; new handler after the `/close` handler at the end of the file)
- Modify: `apps/api/src/db/queries.ts` (new helper)
- Modify: `apps/api/test/helpers.ts` (new helpers)
- Test: `apps/api/test/series.test.ts`

**Interfaces:**
- Consumes: `Room` fields from Task 1; existing `getRoomByCode`, `notFound`, `notCreator`, `invalidStatus`, `validationError`, `errorResponse`.
- Produces:
  - `POST /api/rooms/:code/next-host` — body `{ creatorVoterId: string, nextParticipantId?: string }` → 200 `{ nextHost: { participantId: string, name: string } }`; errors: 403 `NOT_CREATOR`, 400 `INVALID_STATUS` (not rank / not revealed), 400 `VALIDATION_ERROR` (bad participant), 409 `SERIES_CONTINUED`, 404.
  - `getSeriesHostVoterIds(db: D1Database, seriesId: string): Promise<string[]>` in queries.ts.
  - Test helpers `reveal(code, voterId?)`, `revealedRankRoom()`, `pickNextHost(code, nextParticipantId?, voterId?)`.

- [ ] **Step 1: Add test helpers**

Append to `apps/api/test/helpers.ts`:

```ts
export async function reveal(code: string, voterId = CREATOR.voterId) {
  const res = await api("POST", `/rooms/${code}/reveal`, { creatorVoterId: voterId });
  expect(res.status).toBe(200);
}

/** Rank room with 5 items, BOB joined, started, then host force-revealed. */
export async function revealedRankRoom(): Promise<{ code: string; roomId: string }> {
  const { code, roomId } = await createRoom("rank");
  await addItems(code, ["A", "B", "C", "D", "E"]);
  const joined = await join(code, BOB);
  expect(joined.status).toBe(200);
  await start(code);
  await reveal(code);
  return { code, roomId };
}

export async function pickNextHost(
  code: string,
  nextParticipantId?: string,
  voterId = CREATOR.voterId
) {
  return api("POST", `/rooms/${code}/next-host`, {
    creatorVoterId: voterId,
    ...(nextParticipantId ? { nextParticipantId } : {}),
  });
}
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/test/series.test.ts` (extend the imports from `./helpers` with `getParticipants, expectNoVoterIds, pickNextHost, revealedRankRoom, join, addItems, start, reveal, BOB, EVE, CREATOR` and keep `env` from `cloudflare:workers`):

```ts
describe("POST /rooms/:code/next-host", () => {
  it("host picks a specific participant", async () => {
    const { code, roomId } = await revealedRankRoom();
    const parts = await getParticipants(code);
    const bobId = parts.body.participants.find((p: any) => p.name === "Bob").participantId;

    const res = await pickNextHost(code, bobId);
    expect(res.status).toBe(200);
    expect(res.body.nextHost).toEqual({ participantId: bobId, name: "Bob" });
    expectNoVoterIds(res.body);

    const row = await env.DB.prepare("SELECT next_host_voter_id FROM rooms WHERE id = ?")
      .bind(roomId)
      .first<{ next_host_voter_id: string }>();
    expect(row?.next_host_voter_id).toBe(BOB.voterId);
  });

  it("re-picking overwrites the previous pick", async () => {
    const { code, roomId } = await revealedRankRoom();
    const parts = await getParticipants(code);
    const bobId = parts.body.participants.find((p: any) => p.name === "Bob").participantId;
    const cassId = parts.body.participants.find((p: any) => p.name === "Cass").participantId;

    await pickNextHost(code, bobId);
    const res = await pickNextHost(code, cassId);
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT next_host_voter_id FROM rooms WHERE id = ?")
      .bind(roomId)
      .first<{ next_host_voter_id: string }>();
    expect(row?.next_host_voter_id).toBe(CREATOR.voterId);
  });

  it("random pick never chooses someone who already hosted", async () => {
    const { code } = await revealedRankRoom();
    // CREATOR hosted round 1; BOB is the only participant who hasn't.
    const res = await pickNextHost(code);
    expect(res.status).toBe(200);
    expect(res.body.nextHost.name).toBe("Bob");
  });

  it("non-creator cannot pick", async () => {
    const { code } = await revealedRankRoom();
    const res = await pickNextHost(code, undefined, BOB.voterId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_CREATOR");
  });

  it("rejected before results are revealed", async () => {
    const { code } = await createRoom("rank");
    await addItems(code, ["A", "B", "C", "D", "E"]);
    await join(code, BOB);
    await start(code); // status = voting, not revealed
    const res = await pickNextHost(code);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("rejected on non-rank rooms", async () => {
    const { code } = await createRoom("vote");
    await addItems(code, ["A", "B"]);
    await join(code, BOB);
    await start(code);
    await reveal(code);
    const res = await pickNextHost(code);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("unknown participant id is rejected", async () => {
    const { code } = await revealedRankRoom();
    const res = await pickNextHost(code, "not-a-participant-id");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `apps/api`): `npm test -- series`
Expected: FAIL — next-host requests return 404 (route doesn't exist).

- [ ] **Step 4: Implement the query helper and the endpoint**

Append to `apps/api/src/db/queries.ts`:

```ts
// Voter ids of everyone who has hosted a round in this series. The first
// room's series_id is only backfilled once a successor exists, so match on
// series_id OR the series root id itself.
export async function getSeriesHostVoterIds(
  db: D1Database,
  seriesId: string
): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT creator_voter_id FROM rooms WHERE series_id = ?1 OR id = ?1")
    .bind(seriesId)
    .all<{ creator_voter_id: string }>();
  return results.map((r) => r.creator_voter_id);
}
```

In `apps/api/src/routes/rooms.ts`:
1. Extend the validation import (line 4) to include `errorResponse`.
2. Extend the queries import (line 3) to include `getSeriesHostVoterIds`.
3. Append this handler after the `/close` handler at the end of the file:

```ts
// POST /api/rooms/:code/next-host — Pick who hosts the next round (creator only)
// Omit nextParticipantId for a random draw that skips anyone who has already
// hosted a round in this series; once everyone has hosted, the pool resets
// (minus the current host, so random never repeats back-to-back).
rooms.post("/:code/next-host", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { creatorVoterId, nextParticipantId } = body;

  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.mode !== "rank") {
    return invalidStatus("Keep playing is only available in blind rank rooms");
  }
  if (room.status !== "revealed") {
    return invalidStatus("The next host can only be picked after results are revealed");
  }
  if (room.next_room_id) {
    return errorResponse("SERIES_CONTINUED", "The next round has already been created", 409);
  }

  const { results: parts } = await db
    .prepare(
      "SELECT id, voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ id: string; voter_id: string; voter_name: string }>();

  let chosen: { id: string; voter_id: string; voter_name: string } | undefined;
  if (nextParticipantId !== undefined) {
    if (typeof nextParticipantId !== "string") {
      return validationError("nextParticipantId must be a string");
    }
    chosen = parts.find((p) => p.id === nextParticipantId);
    if (!chosen) {
      return validationError("nextParticipantId is not a participant of this room");
    }
  } else {
    const seriesId = room.series_id ?? room.id;
    const hosted = new Set(await getSeriesHostVoterIds(db, seriesId));
    let pool = parts.filter((p) => !hosted.has(p.voter_id));
    if (pool.length === 0) {
      // Everyone has hosted — reset, but never repeat the current host
      // back-to-back unless they are the only participant.
      pool = parts.filter((p) => p.voter_id !== room.creator_voter_id);
      if (pool.length === 0) pool = parts;
    }
    chosen = pool[Math.floor(Math.random() * pool.length)];
  }

  await db
    .prepare("UPDATE rooms SET next_host_voter_id = ? WHERE id = ?")
    .bind(chosen.voter_id, room.id)
    .run();

  return Response.json({
    nextHost: { participantId: chosen.id, name: chosen.voter_name },
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `apps/api`): `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/rooms.ts apps/api/src/db/queries.ts apps/api/test/helpers.ts apps/api/test/series.test.ts
git commit -m "feat(api): next-host endpoint with no-repeat random draw"
```

---

### Task 3: Successor room creation (`POST /api/rooms` + `previousRoomCode`)

**Files:**
- Modify: `apps/api/src/routes/rooms.ts` (the `POST /` handler, lines 9–71)
- Modify: `apps/api/test/helpers.ts` (new helpers)
- Test: `apps/api/test/series.test.ts`

**Interfaces:**
- Consumes: Task 1 columns, Task 2 endpoint (`pickNextHost` helper), `errorResponse`.
- Produces:
  - `POST /api/rooms` accepts optional `previousRoomCode: string`; success response gains `roundNumber: number`. Errors: 403 `NOT_NEXT_HOST`, 409 `SERIES_CONTINUED`, 400 `INVALID_STATUS`/`VALIDATION_ERROR`, 404.
  - Successor rows: `series_id = previous.series_id ?? previous.id`, `round_number = previous.round_number + 1`; previous row gets `next_room_id` set and `series_id` backfilled.
  - Test helpers `addItemsAs(code, titles, host)`, `startAs(code, host)`, `createNextRound(prevCode, host, topic?)`.

- [ ] **Step 1: Add test helpers**

Append to `apps/api/test/helpers.ts`:

```ts
export async function addItemsAs(
  code: string,
  titles: string[],
  host: { voterId: string; name: string }
) {
  const res = await api("POST", `/rooms/${code}/items`, {
    items: titles,
    creatorVoterId: host.voterId,
  });
  expect(res.status).toBe(201);
  return res.body.items as { id: string; title: string }[];
}

export async function startAs(code: string, host: { voterId: string; name: string }) {
  const res = await api("POST", `/rooms/${code}/start`, {
    creatorVoterId: host.voterId,
  });
  expect(res.status).toBe(200);
}

export async function createNextRound(
  prevCode: string,
  host: { voterId: string; name: string },
  topic = "Next round topic"
) {
  return api("POST", "/rooms", {
    topic,
    creatorVoterId: host.voterId,
    creatorName: host.name,
    mode: "rank",
    previousRoomCode: prevCode,
  });
}
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/test/series.test.ts` (extend the `./helpers` import with `createNextRound, addItemsAs, startAs`):

```ts
async function pickedBob(code: string): Promise<string> {
  const parts = await getParticipants(code);
  const bobId = parts.body.participants.find((p: any) => p.name === "Bob").participantId;
  const res = await pickNextHost(code, bobId);
  expect(res.status).toBe(200);
  return bobId;
}

describe("POST /rooms with previousRoomCode", () => {
  it("the designated next host creates round 2, linked into a series", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);

    const res = await createNextRound(code, BOB);
    expect(res.status).toBe(201);
    expect(res.body.roundNumber).toBe(2);

    const newRoom = await env.DB.prepare(
      "SELECT series_id, round_number FROM rooms WHERE id = ?"
    )
      .bind(res.body.id)
      .first<any>();
    expect(newRoom).toEqual({ series_id: roomId, round_number: 2 });

    const prev = await env.DB.prepare(
      "SELECT series_id, next_room_id FROM rooms WHERE id = ?"
    )
      .bind(roomId)
      .first<any>();
    expect(prev).toEqual({ series_id: roomId, next_room_id: res.body.id });
  });

  it("a caller who wasn't picked gets 403", async () => {
    const { code } = await revealedRankRoom();
    await pickedBob(code);
    const res = await createNextRound(code, EVE);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_NEXT_HOST");
  });

  it("no next host picked yet means 403", async () => {
    const { code } = await revealedRankRoom();
    const res = await createNextRound(code, BOB);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_NEXT_HOST");
  });

  it("cannot continue a room that isn't revealed", async () => {
    const { code } = await createRoom("rank");
    await addItems(code, ["A", "B", "C", "D", "E"]);
    const res = await createNextRound(code, BOB);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("a second successor gets 409 and leaves no orphan room", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);
    const first = await createNextRound(code, BOB);
    expect(first.status).toBe(201);

    const second = await createNextRound(code, BOB);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("SERIES_CONTINUED");

    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM rooms WHERE series_id = ?"
    )
      .bind(roomId)
      .first<{ c: number }>();
    expect(count?.c).toBe(2); // round 1 (backfilled) + round 2, nothing else
  });

  it("concurrent duplicate creates yield one 201 and one 409", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);

    const [a, b] = await Promise.all([
      createNextRound(code, BOB),
      createNextRound(code, BOB),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM rooms WHERE series_id = ?"
    )
      .bind(roomId)
      .first<{ c: number }>();
    expect(count?.c).toBe(2);
  });

  it("next-host is locked once the series has continued", async () => {
    const { code } = await revealedRankRoom();
    const bobId = await pickedBob(code);
    const created = await createNextRound(code, BOB);
    expect(created.status).toBe(201);

    const res = await pickNextHost(code, bobId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SERIES_CONTINUED");
  });

  it("round 3 keeps the original series id, and the reset random pool skips the current host", async () => {
    const { code, roomId } = await revealedRankRoom();
    await pickedBob(code);
    const r2 = await createNextRound(code, BOB);
    const code2 = r2.body.code as string;

    // Play round 2 to reveal: CREATOR joins, BOB (the new creator) runs it.
    await join(code2, CREATOR);
    await addItemsAs(code2, ["F", "G", "H", "I", "J"], BOB);
    await startAs(code2, BOB);
    await reveal(code2, BOB.voterId);

    // Both participants have hosted → pool resets minus BOB (current host).
    const pick = await pickNextHost(code2, undefined, BOB.voterId);
    expect(pick.status).toBe(200);
    expect(pick.body.nextHost.name).toBe("Cass");

    const r3 = await createNextRound(code2, CREATOR);
    expect(r3.status).toBe(201);
    expect(r3.body.roundNumber).toBe(3);
    const room3 = await env.DB.prepare("SELECT series_id FROM rooms WHERE id = ?")
      .bind(r3.body.id)
      .first<{ series_id: string }>();
    expect(room3?.series_id).toBe(roomId);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `apps/api`): `npm test -- series`
Expected: FAIL — `previousRoomCode` is ignored, so the "403"/"409"/linkage assertions all fail (rooms are created as standalone 201s with no `roundNumber`).

- [ ] **Step 4: Implement in the `POST /` handler**

In `apps/api/src/routes/rooms.ts`, `POST /` handler:

1. After `const db = c.env.DB;` and `const id = crypto.randomUUID();` (lines 33–34), insert the previous-room validation:

```ts
  // Successor-room creation: only the designated next host of a revealed
  // rank room may chain a new round onto it.
  let prevRoom: Awaited<ReturnType<typeof getRoomByCode>> = null;
  if (body.previousRoomCode !== undefined) {
    if (typeof body.previousRoomCode !== "string") {
      return validationError("previousRoomCode must be a string");
    }
    if (mode !== "rank") {
      return validationError("Only blind rank rooms can continue a series");
    }
    prevRoom = await getRoomByCode(db, body.previousRoomCode.toUpperCase());
    if (!prevRoom) return notFound();
    if (prevRoom.mode !== "rank") {
      return invalidStatus("Only blind rank rooms can continue a series");
    }
    if (prevRoom.status !== "revealed") {
      return invalidStatus("The previous round hasn't been revealed yet");
    }
    if (prevRoom.next_room_id) {
      return errorResponse("SERIES_CONTINUED", "The next round has already been created", 409);
    }
    if (prevRoom.next_host_voter_id !== creatorVoterId) {
      return errorResponse("NOT_NEXT_HOST", "The host picked someone else to create the next round", 403);
    }
  }
```

2. Replace the room INSERT (lines 54–59) so it writes the series fields:

```ts
  const seriesId = prevRoom ? prevRoom.series_id ?? prevRoom.id : null;
  const roundNumber = prevRoom ? prevRoom.round_number + 1 : 1;

  await db
    .prepare(
      "INSERT INTO rooms (id, code, topic, creator_voter_id, status, allow_suggestions, mode, created_at, expires_at, series_id, round_number) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, code!, topic.trim(), creatorVoterId, allowSuggestions, mode, now, expiresAt, seriesId, roundNumber)
    .run();
```

3. After the creator auto-join INSERT (lines 61–65), add the link step. D1 batches can't conditionally abort, so the guarded UPDATE is the arbiter; the loser cleans up its own rows:

```ts
  if (prevRoom) {
    const link = await db
      .prepare(
        "UPDATE rooms SET next_room_id = ?, series_id = COALESCE(series_id, id) WHERE id = ? AND next_room_id IS NULL"
      )
      .bind(id, prevRoom.id)
      .run();
    if ((link.meta.changes ?? 0) === 0) {
      // A concurrent create already linked a successor — remove our orphan.
      await db.batch([
        db.prepare("DELETE FROM participants WHERE room_id = ?").bind(id),
        db.prepare("DELETE FROM rooms WHERE id = ?").bind(id),
      ]);
      return errorResponse("SERIES_CONTINUED", "The next round has already been created", 409);
    }
  }
```

4. Extend the success response (lines 67–70):

```ts
  return Response.json(
    { id, code: code!, topic: topic.trim(), mode, createdAt: now, expiresAt, roundNumber },
    { status: 201 }
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `apps/api`): `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/rooms.ts apps/api/test/helpers.ts apps/api/test/series.test.ts
git commit -m "feat(api): chain successor rooms into a series via previousRoomCode"
```

---

### Task 4: Expose `nextHost` / `nextRoomCode` / `roundNumber` on status and room GETs

**Files:**
- Modify: `apps/api/src/routes/results.ts` (`GET /:code/status` handler, lines 20–78)
- Modify: `apps/api/src/routes/rooms.ts` (`GET /:code` handler, response object around lines 361–369)
- Modify: `apps/api/src/db/queries.ts` (new helper)
- Test: `apps/api/test/series.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `GET /api/rooms/:code/status` for rank rooms adds `roundNumber: number`, `nextHost: { participantId, name } | null`, `nextRoomCode: string | null` (the last two are non-null only when revealed and set). Non-rank responses unchanged.
  - `GET /api/rooms/:code` adds `roundNumber: number` (all modes) and `nextRoomCode: string` when a successor exists.
  - `getLatestSeriesRoom(db: D1Database, seriesId: string): Promise<Room | null>` in queries.ts — newest unexpired room in the series.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/series.test.ts` (extend the `./helpers` import with `getRoom, startedVoteRoom, api`). These tests reuse the `pickedBob` helper that Task 3 defined at the top level of this same test file:

```ts
describe("series exposure on GET /status and GET /rooms/:code", () => {
  it("a revealed rank room starts with no next host or next room", async () => {
    const { code } = await revealedRankRoom();
    const res = await api("GET", `/rooms/${code}/status`);
    expect(res.status).toBe(200);
    expect(res.body.roundNumber).toBe(1);
    expect(res.body.nextHost).toBeNull();
    expect(res.body.nextRoomCode).toBeNull();
    expectNoVoterIds(res.body);
  });

  it("status shows the picked next host by participant id only", async () => {
    const { code } = await revealedRankRoom();
    const bobId = await pickedBob(code);
    const res = await api("GET", `/rooms/${code}/status`);
    expect(res.body.nextHost).toEqual({ participantId: bobId, name: "Bob" });
    expectNoVoterIds(res.body);
  });

  it("status and room GETs point at the NEWEST round in the series", async () => {
    // Build a 3-round chain.
    const { code } = await revealedRankRoom();
    await pickedBob(code);
    const r2 = await createNextRound(code, BOB);
    const code2 = r2.body.code as string;
    await join(code2, CREATOR);
    await addItemsAs(code2, ["F", "G", "H", "I", "J"], BOB);
    await startAs(code2, BOB);
    await reveal(code2, BOB.voterId);
    await pickNextHost(code2, undefined, BOB.voterId); // resets pool → Cass
    const r3 = await createNextRound(code2, CREATOR);
    const code3 = r3.body.code as string;

    const s1 = await api("GET", `/rooms/${code}/status`);
    expect(s1.body.nextRoomCode).toBe(code3); // multi-hop resolution
    const s2 = await api("GET", `/rooms/${code2}/status`);
    expect(s2.body.nextRoomCode).toBe(code3);
    const s3 = await api("GET", `/rooms/${code3}/status`);
    expect(s3.body.roundNumber).toBe(3);
    expect(s3.body.nextRoomCode).toBeNull();

    const room1 = await getRoom(code);
    expect(room1.body.nextRoomCode).toBe(code3);
    expect(room1.body.roundNumber).toBe(1);
  });

  it("vote-mode status keeps its existing shape", async () => {
    const { code } = await startedVoteRoom();
    const res = await api("GET", `/rooms/${code}/status`);
    expect(res.status).toBe(200);
    expect(res.body.roundNumber).toBeUndefined();
    expect(res.body.nextHost).toBeUndefined();
    expect(res.body.nextRoomCode).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/api`): `npm test -- series`
Expected: FAIL — `roundNumber`/`nextHost`/`nextRoomCode` are undefined on rank status responses.

- [ ] **Step 3: Implement**

Append to `apps/api/src/db/queries.ts`:

```ts
// Newest unexpired room in a series — the round latecomers should land in.
export async function getLatestSeriesRoom(
  db: D1Database,
  seriesId: string
): Promise<Room | null> {
  return db
    .prepare(
      "SELECT * FROM rooms WHERE (series_id = ?1 OR id = ?1) AND expires_at > datetime('now') ORDER BY round_number DESC LIMIT 1"
    )
    .bind(seriesId)
    .first<Room>();
}
```

In `apps/api/src/routes/results.ts`:
1. Add `getLatestSeriesRoom` to the queries import.
2. In the `GET /:code/status` handler, replace the final `return Response.json({...})` (lines 72–77) with:

```ts
  const payload: Record<string, unknown> = {
    totalVoters,
    completedCount,
    isRevealed: room.status === "revealed",
    voters,
  };

  if (room.mode === "rank") {
    payload.roundNumber = room.round_number;
    payload.nextHost = null;
    payload.nextRoomCode = null;
    if (room.status === "revealed") {
      if (room.next_host_voter_id) {
        const nh = await db
          .prepare("SELECT id, voter_name FROM participants WHERE room_id = ? AND voter_id = ?")
          .bind(room.id, room.next_host_voter_id)
          .first<{ id: string; voter_name: string }>();
        if (nh) payload.nextHost = { participantId: nh.id, name: nh.voter_name };
      }
      if (room.next_room_id) {
        const latest = await getLatestSeriesRoom(db, room.series_id ?? room.id);
        if (latest && latest.round_number > room.round_number) {
          payload.nextRoomCode = latest.code;
        }
      }
    }
  }

  return Response.json(payload);
```

In `apps/api/src/routes/rooms.ts`, `GET /:code` handler:
1. Add `getLatestSeriesRoom` to the queries import.
2. After the `response` object is built (line 369), add:

```ts
  response.roundNumber = room.round_number;
  if (room.next_room_id) {
    const latest = await getLatestSeriesRoom(db, room.series_id ?? room.id);
    if (latest && latest.round_number > room.round_number) {
      response.nextRoomCode = latest.code;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `apps/api`): `npm test`
Expected: all PASS (including the untouched vote/bracket suites).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/results.ts apps/api/src/routes/rooms.ts apps/api/src/db/queries.ts apps/api/test/series.test.ts
git commit -m "feat(api): expose next host, next room code, and round number"
```

---

### Task 5: Mobile API client + friendly messages

**Files:**
- Modify: `apps/mobile/lib/api.ts`

**Interfaces:**
- Consumes: Task 2–4 endpoint shapes.
- Produces (used by Tasks 6–8):
  - `pickNextHost(code: string, body: { creatorVoterId: string; nextParticipantId?: string }): Promise<{ nextHost: { participantId: string; name: string } }>`
  - `StatusResponse` gains `roundNumber?: number; nextHost?: { participantId: string; name: string } | null; nextRoomCode?: string | null;`
  - `RoomResponse` gains `roundNumber?: number; nextRoomCode?: string;`
  - `createRoom` body gains `previousRoomCode?: string;`; `CreateRoomResponse` gains `roundNumber?: number;`
  - Friendly messages for `NOT_NEXT_HOST` and `SERIES_CONTINUED`.

- [ ] **Step 1: Implement**

In `apps/mobile/lib/api.ts`:

1. Add to `FRIENDLY_MESSAGES` (lines 3–9):

```ts
  NOT_NEXT_HOST: "The host picked someone else to create the next round.",
  SERIES_CONTINUED: "The next round has already been created.",
```

2. Add `roundNumber?: number;` to `CreateRoomResponse` (after `expiresAt: string;`).

3. Add `previousRoomCode?: string;` to the `createRoom` body type (after `mode?: ...`).

4. Add to `RoomResponse` (after `myTiers?: Record<string, string>;`):

```ts
  roundNumber?: number;
  nextRoomCode?: string;
```

5. Add to `StatusResponse` (after `currentRound?: number | null;`):

```ts
  roundNumber?: number;
  nextHost?: { participantId: string; name: string } | null;
  nextRoomCode?: string | null;
```

6. Add after `getStatus` (line 201):

```ts
export function pickNextHost(
  code: string,
  body: { creatorVoterId: string; nextParticipantId?: string }
) {
  return request<{ nextHost: { participantId: string; name: string } }>(
    `/rooms/${code}/next-host`,
    { method: "POST", body: JSON.stringify(body) }
  );
}
```

- [ ] **Step 2: Verify with the type checker**

Run (from `apps/mobile`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/api.ts
git commit -m "feat(mobile): api client support for next-host and series fields"
```

---

### Task 6: Results screen — keep playing, next-host picker, auto-advance

**Files:**
- Modify: `apps/mobile/app/room/[code]/results.tsx`

**Interfaces:**
- Consumes: Task 5 client functions; existing `usePolling` (`apps/mobile/lib/usePolling.ts`), `getActiveRoom`/`saveActiveRoom`/`clearActiveRoom` (`lib/storage.ts`), `showAlert` (`lib/alert.ts`), `getParticipants`, `joinRoom`, `getRoom`, `getStatus`.
- Produces: navigation into `/create` with params `{ mode: "rank", previousRoomCode, name }` (Task 7 consumes these exact param names) and into `/room/[code]/lobby` with `{ code, name }`.

Behavior summary (all inside the rank branch only):
- Stop clearing the active room for rank results; clear it on "Back to Home" instead.
- Poll `/status` every 3s: track `nextHost`; when `nextRoomCode` appears, auto-join and replace to the new lobby — unless this player IS the next host (they navigate via the create flow).
- Host sees "Keep Playing" (label flips to "Change next host" after a pick) → a modal listing participants + "🎲 Pick randomly".
- Everyone sees a banner naming the next host; the picked player instead sees a "You're up!" button.

- [ ] **Step 1: Implement**

In `apps/mobile/app/room/[code]/results.tsx`:

1. Update imports: add `Modal` to the `react-native` import; add `useRef` to the react import; extend the api import to `import { getResults, getStatus, getParticipants, joinRoom, getRoom, pickNextHost, type ResultsResponse, type Participant } from "../../../lib/api";`; extend the storage import to `import { getVoterId, clearActiveRoom, getActiveRoom, saveActiveRoom } from "../../../lib/storage";`; add `import { usePolling } from "../../../lib/usePolling";` and `import { showAlert } from "../../../lib/alert";`.

2. Read the `name` param alongside `code` (line 39):

```ts
  const { code, name } = useLocalSearchParams<{ code: string; name?: string }>();
```

3. Add state below the existing state declarations (after line 46):

```ts
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [nextHost, setNextHost] = useState<{ participantId: string; name: string } | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
```

4. In `loadResults`, change the clear-on-render logic so rank rooms keep their active-room record (replace lines 56–71):

```ts
      if (!res.revealed) {
        setError("Results aren't ready yet. Waiting for everyone to finish.");
      } else {
        if ("mode" in res && res.mode === "rank") {
          // Rank rooms may continue into another round — keep the rejoin
          // banner alive until the player actually leaves for home.
          setRankData(res);
        } else {
          // Only forget the room once we've actually shown its results —
          // clearing on mount destroyed the rejoin banner for live rooms
          // whenever this screen was reached early.
          clearActiveRoom();
          if ("mode" in res && res.mode === "bracket") {
            setBracketData(res as RevealedBracketResults);
          } else if ("mode" in res && res.mode === "mlt") {
            setMltData(res as RevealedMltResults);
          } else if ("mode" in res && res.mode === "tier") {
            setTierData(res as RevealedTierResults);
          } else {
            setVoteData(res as RevealedVoteResults);
          }
        }
      }
```

5. Add the series logic after the `useEffect` that calls `loadResults` (after line 82):

```ts
  const me = participants.find((p) => p.isYou);
  const isHost = !!me?.isCreator;
  const iAmNext = !!(nextHost && me && nextHost.participantId === me.participantId);

  const resolveDisplayName = async (): Promise<string | null> => {
    if (name) return name;
    const active = await getActiveRoom();
    return active?.name ?? null;
  };

  const advanceToNextRound = async (newCode: string) => {
    setAdvancing(true);
    try {
      const displayName = await resolveDisplayName();
      if (!displayName) {
        // Never joined under a name (e.g. viewed results via an old code) —
        // run them through the normal name entry for the new room.
        router.replace({ pathname: "/join/name", params: { code: newCode } });
        return;
      }
      const voterId = await getVoterId();
      await joinRoom(newCode, { voterId, voterName: displayName });
      const newRoom = await getRoom(newCode, voterId);
      await saveActiveRoom({ code: newCode, topic: newRoom.topic, name: displayName });
      router.replace({
        pathname: "/room/[code]/lobby",
        params: { code: newCode, name: displayName },
      });
    } catch {
      setAdvancing(false); // next poll tick retries
    }
  };

  usePolling(async (stop) => {
    // Series flow exists only for rank rooms; stop once another mode loaded.
    if (voteData || bracketData || mltData || tierData) {
      stop();
      return;
    }
    if (!rankData) return;
    try {
      const voterId = await getVoterId();
      let partsList = participants;
      if (partsList.length === 0) {
        const parts = await getParticipants(code, voterId);
        partsList = parts.participants;
        setParticipants(partsList);
      }
      const status = await getStatus(code);
      if (status.nextHost !== undefined) setNextHost(status.nextHost ?? null);
      if (status.nextRoomCode) {
        stop();
        const self = partsList.find((p) => p.isYou);
        const selfIsNext = !!(
          status.nextHost && self && status.nextHost.participantId === self.participantId
        );
        // The new host reaches the new room through the create flow instead.
        if (!selfIsNext) await advanceToNextRound(status.nextRoomCode);
      }
    } catch {}
  }, 3000);

  const handlePick = async (participantId?: string) => {
    try {
      const voterId = await getVoterId();
      const res = await pickNextHost(code, {
        creatorVoterId: voterId,
        ...(participantId ? { nextParticipantId: participantId } : {}),
      });
      setNextHost(res.nextHost);
      setShowPicker(false);
    } catch (e: any) {
      showAlert("Error", e.message);
    }
  };
```

6. In the rank branch JSX (lines 113–140), replace the "Back to Home" pressable with the keep-playing block:

```tsx
        {advancing ? (
          <View style={styles.nextHostBanner}>
            <Text style={styles.nextHostBannerText}>Heading to the next round…</Text>
          </View>
        ) : (
          <>
            {nextHost && !iAmNext && (
              <View style={styles.nextHostBanner}>
                <Text style={styles.nextHostBannerText}>
                  🎲 {nextHost.name} is up next — waiting for their category…
                </Text>
              </View>
            )}
            {iAmNext && (
              <Pressable
                style={({ pressed }) => [styles.youreUpButton, pressed && { opacity: 0.85 }]}
                onPress={() =>
                  router.push({
                    pathname: "/create",
                    params: { mode: "rank", previousRoomCode: code, name: name ?? "" },
                  })
                }
              >
                <Text style={styles.youreUpText}>You're up! Create the next category</Text>
              </Pressable>
            )}
            {isHost && (
              <Pressable
                style={({ pressed }) => [styles.keepPlayingButton, pressed && styles.homeButtonPressed]}
                onPress={() => setShowPicker(true)}
              >
                <Text style={styles.homeButtonText}>
                  {nextHost ? "Change next host" : "Keep Playing"}
                </Text>
              </Pressable>
            )}
          </>
        )}
        <Pressable
          style={({ pressed }) => [styles.homeLink, pressed && { opacity: 0.6 }]}
          onPress={async () => {
            await clearActiveRoom();
            router.replace("/");
          }}
        >
          <Text style={styles.homeLinkText}>Back to Home</Text>
        </Pressable>

        <Modal
          visible={showPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <Text style={styles.pickerTitle}>Who hosts the next round?</Text>
              <Pressable style={styles.pickerRandom} onPress={() => handlePick()}>
                <Text style={styles.pickerRandomText}>🎲 Pick randomly</Text>
              </Pressable>
              {participants.map((p) => (
                <Pressable
                  key={p.participantId}
                  style={styles.pickerRow}
                  onPress={() => handlePick(p.participantId)}
                >
                  <Text style={styles.pickerRowText}>
                    {p.isYou ? `${p.name} (you)` : p.name}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setShowPicker(false)}>
                <Text style={styles.pickerCancel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
```

(The `Modal` sits inside the rank branch's `ScrollView` return, after the home link.)

7. Add styles to the main `StyleSheet.create` block:

```ts
  keepPlayingButton: {
    backgroundColor: colors.coral,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    ...shadows.button,
  },
  youreUpButton: {
    backgroundColor: colors.teal,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    ...shadows.button,
  },
  youreUpText: {
    color: colors.warmWhite,
    fontSize: 18,
    fontWeight: "700",
  },
  nextHostBanner: {
    backgroundColor: colors.warmWhite,
    borderWidth: 2,
    borderColor: colors.amber,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
  },
  nextHostBannerText: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: "center",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  pickerCard: {
    backgroundColor: colors.warmWhite,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  pickerTitle: {
    ...typography.h3,
    color: colors.charcoal,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  pickerRandom: {
    backgroundColor: colors.coral,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  pickerRandomText: {
    ...typography.bodyBold,
    color: colors.warmWhite,
  },
  pickerRow: {
    backgroundColor: colors.sandLight,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  pickerRowText: {
    ...typography.bodyBold,
    color: colors.charcoal,
  },
  pickerCancel: {
    ...typography.body,
    color: colors.mist,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
```

Also update the rank branch's `ScrollView` `contentContainerStyle` — the buttons carry their own horizontal margins, so no other layout change is needed. The "Keep playing" copy strings above are final.

- [ ] **Step 2: Verify with the type checker**

Run (from `apps/mobile`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/room/[code]/results.tsx"
git commit -m "feat(mobile): keep-playing flow on the rank results screen"
```

---

### Task 7: Create flow — successor round wiring

**Files:**
- Modify: `apps/mobile/app/create/index.tsx`

**Interfaces:**
- Consumes: Task 5 `createRoom` with `previousRoomCode`; Task 6 navigation params `{ mode: "rank", previousRoomCode, name }`.
- Produces: unchanged navigation into `/create/share` with `{ code, name, mode }` (the share screen already handles the rest of the flow: 5 items + Start).

- [ ] **Step 1: Implement**

In `apps/mobile/app/create/index.tsx`:

1. Read the new params and prefill the name (replace lines 20 and 31–32):

```ts
  const { mode: modeParam, previousRoomCode, name: nameParam } = useLocalSearchParams<{
    mode?: string;
    previousRoomCode?: string;
    name?: string;
  }>();
```

```ts
  const [topic, setTopic] = useState("");
  const [name, setName] = useState(nameParam ?? "");
```

2. In `handleCreate`, pass `previousRoomCode` through and handle series rejections (replace the `createRoom` call and the catch block, lines 46–66):

```ts
      const room = await createRoom({
        topic: trimmedTopic,
        creatorVoterId: voterId,
        creatorName: trimmedName,
        allowSuggestions: mode === "vote" ? allowSuggestions : false,
        mode,
        ...(previousRoomCode ? { previousRoomCode } : {}),
      });
```

```ts
    } catch (e: any) {
      if (previousRoomCode && (e.code === "NOT_NEXT_HOST" || e.code === "SERIES_CONTINUED")) {
        // The pick changed (or the round already exists) while we were typing.
        showAlert("Round moved on", e.message, () =>
          router.replace({
            pathname: "/room/[code]/results",
            params: { code: previousRoomCode, name: trimmedName },
          })
        );
        return;
      }
      showAlert("Error", e.message);
    } finally {
      setLoading(false);
    }
```

3. Hide the name field when it came in as a param, and adjust the topic label for next rounds. Replace the topic label text (line 77) with:

```tsx
        <Text style={styles.label}>
          {previousRoomCode ? "What's the next category?" : "What are you deciding?"}
        </Text>
```

Wrap the name field group (lines 89–99) in a condition:

```tsx
      {!nameParam && (
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Your display name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Alex"
            placeholderTextColor={colors.mist}
            value={name}
            onChangeText={setName}
            maxLength={30}
          />
        </View>
      )}
```

(If `nameParam` arrives as an empty string — the picked host reached results without a `name` param — the field renders normally because `!""` is true, and the player types a name.)

- [ ] **Step 2: Verify with the type checker**

Run (from `apps/mobile`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/create/index.tsx
git commit -m "feat(mobile): create screen chains next rounds via previousRoomCode"
```

---

### Task 8: Latecomer forwarding + Round N labels

**Files:**
- Modify: `apps/mobile/app/join/name.tsx` (`handleContinue`, lines 23–76)
- Modify: `apps/mobile/app/room/[code]/lobby.tsx`
- Modify: `apps/mobile/app/room/[code]/waiting.tsx`

**Interfaces:**
- Consumes: Task 4/5 `RoomResponse.nextRoomCode`, `RoomResponse.roundNumber`, `StatusResponse.roundNumber`.
- Produces: user-visible "ROUND N" / "Round N" labels; no new exports.

- [ ] **Step 1: Implement join forwarding**

In `apps/mobile/app/join/name.tsx`, `handleContinue`: the room lookup gains a forward hop, and every navigation below uses the forwarded code. Replace the body of the `try` block (lines 29–70) with:

```ts
      const voterId = await getVoterId();
      let room = await getRoom(code, voterId);

      // A code from an earlier round forwards to the newest round in the
      // series (the server resolves multi-hop chains to one code).
      let targetCode = code;
      if (room.nextRoomCode) {
        targetCode = room.nextRoomCode;
        room = await getRoom(targetCode, voterId);
      }

      // The API rejects joins on closed/revealed rooms, so check status first.
      if (room.status === "closed") {
        showAlert("Room Closed", "The host closed this room.");
        return;
      }
      if (room.status === "revealed") {
        // Voting is over — show the results without registering as a participant.
        router.replace({
          pathname: "/room/[code]/results",
          params: { code: targetCode, name: trimmed },
        });
        return;
      }

      // Register as a participant
      await joinRoom(targetCode, { voterId, voterName: trimmed });
      await saveActiveRoom({ code: targetCode, topic: room.topic, name: trimmed });

      if (room.status === "open") {
        router.replace({
          pathname: "/room/[code]/lobby",
          params: { code: targetCode, name: trimmed },
        });
      } else if (room.status === "voting") {
        router.replace({
          pathname:
            room.mode === "rank" ? "/room/[code]/rank" :
            room.mode === "bracket" ? "/room/[code]/bracket" :
            room.mode === "mlt" ? "/room/[code]/mlt" :
            room.mode === "tier" ? "/room/[code]/tier" :
            "/room/[code]/swipe",
          params: { code: targetCode, name: trimmed, isCreator: "false" },
        });
      } else {
        router.replace({
          pathname: "/room/[code]/results",
          params: { code: targetCode, name: trimmed },
        });
      }
```

- [ ] **Step 2: Implement the lobby badge**

In `apps/mobile/app/room/[code]/lobby.tsx`:

1. Add state next to the other state (after line 61): `const [roundNumber, setRoundNumber] = useState(1);`
2. In the polling callback, after `setItems(room.items);` (line 74): `if (room.roundNumber) setRoundNumber(room.roundNumber);`
3. In the JSX, above the `{topic && (...)}` block (line 145), add:

```tsx
        {roundNumber > 1 && (
          <Text style={styles.roundBadge}>ROUND {roundNumber}</Text>
        )}
```

4. Add the style:

```ts
  roundBadge: {
    ...typography.tiny,
    color: colors.amber,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
```

- [ ] **Step 3: Implement the waiting caption**

In `apps/mobile/app/room/[code]/waiting.tsx`:

1. Under the `Waiting for others` heading (after line 125), add:

```tsx
        {status?.roundNumber && status.roundNumber > 1 ? (
          <Text style={styles.roundCaption}>Round {status.roundNumber}</Text>
        ) : null}
```

2. Add the style:

```ts
  roundCaption: {
    ...typography.caption,
    color: colors.mist,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
  },
```

- [ ] **Step 4: Verify with the type checker**

Run (from `apps/mobile`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/join/name.tsx "apps/mobile/app/room/[code]/lobby.tsx" "apps/mobile/app/room/[code]/waiting.tsx"
git commit -m "feat(mobile): forward old codes to the newest round; round labels"
```

---

### Task 9: Full verification pass

**Files:** none (verification only; fix regressions in place if found).

- [ ] **Step 1: API test suite**

Run (from `apps/api`): `npm test`
Expected: every suite PASSES (series, races, membership, status-gates, participants-privacy, results-privacy).

- [ ] **Step 2: Mobile type check**

Run (from `apps/mobile`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual end-to-end on Expo web**

Web identity is per-tab (`sessionStorage`), so two browser tabs are two players. Run `npx expo start --web` from `apps/mobile` against the deployed API (or `wrangler dev` from `apps/api` with `API_BASE` pointed locally), then walk:

1. Tab A: Create → Blind Rank → topic + name "Ana" → add 5 items.
2. Tab B: Join with the code → name "Ben" → lobby.
3. Tab A: Start → both tabs rank all 5 → results reveal.
4. Tab A: **Keep Playing** → pick Ben → banner appears in Tab A; Tab B shows "You're up!".
5. Tab B: Create the next category → 5 items → verify Tab A auto-lands in the Round 2 lobby (no taps), showing "ROUND 2".
6. Tab B: Start → both rank → reveal → Tab B (now host): Keep Playing → **Pick randomly** → must pick Ana (no-repeat rule).
7. Tab C (new tab): Join using the ROUND 1 code → verify forwarding lands in the current round.
8. Tab A: re-pick a different next host before the round is created → the "You're up!" button moves accordingly; the displaced host's create attempt shows the friendly "Round moved on" alert.
9. Any tab: Back to Home from results mid-series → rejoin banner is gone for that player; others are unaffected.

Expected: every step behaves as written; no dead-ends, no manual code entry between rounds for existing players.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found in keep-playing verification pass"
```
