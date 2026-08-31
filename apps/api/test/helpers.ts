import { exports } from "cloudflare:workers";
import { expect } from "vitest";

// Every fake credential carries this prefix so a single substring check can
// prove a response contains no voter ids.
export const SECRET_PREFIX = "voter-secret-";

export const CREATOR = { voterId: `${SECRET_PREFIX}creator`, name: "Cass" };
export const BOB = { voterId: `${SECRET_PREFIX}bob`, name: "Bob" };
export const EVE = { voterId: `${SECRET_PREFIX}eve`, name: "Eve" };
export const GHOST = { voterId: `${SECRET_PREFIX}ghost`, name: "Ghost" };

export async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await exports.default.fetch(`https://test.local/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

export function expectNoVoterIds(payload: unknown) {
  expect(JSON.stringify(payload)).not.toContain(SECRET_PREFIX);
}

export async function createRoom(
  mode: "vote" | "rank" | "bracket" | "mlt" | "tier",
  opts: { allowSuggestions?: boolean } = {}
): Promise<{ code: string; roomId: string }> {
  const res = await api("POST", "/rooms", {
    topic: "Test topic",
    creatorVoterId: CREATOR.voterId,
    creatorName: CREATOR.name,
    mode,
    ...opts,
  });
  expect(res.status).toBe(201);
  return { code: res.body.code, roomId: res.body.id };
}

export async function join(code: string, p: { voterId: string; name: string }) {
  return api("POST", `/rooms/${code}/join`, {
    voterId: p.voterId,
    voterName: p.name,
  });
}

export async function addItems(code: string, titles: string[]) {
  const res = await api("POST", `/rooms/${code}/items`, {
    items: titles,
    creatorVoterId: CREATOR.voterId,
  });
  expect(res.status).toBe(201);
  return res.body.items as { id: string; title: string }[];
}

export async function start(code: string) {
  const res = await api("POST", `/rooms/${code}/start`, {
    creatorVoterId: CREATOR.voterId,
  });
  expect(res.status).toBe(200);
}

/** Create a vote-mode room with items, joined participants, and voting started. */
export async function startedVoteRoom(
  titles = ["Pizza", "Sushi"],
  participants = [BOB]
): Promise<{ code: string; roomId: string; items: { id: string }[] }> {
  const { code, roomId } = await createRoom("vote");
  const items = await addItems(code, titles);
  for (const p of participants) {
    const res = await join(code, p);
    expect(res.status).toBe(200);
  }
  await start(code);
  return { code, roomId, items };
}

export async function submitVote(
  code: string,
  p: { voterId: string; name: string },
  itemId: string,
  vote: "yes" | "no" = "yes"
) {
  return api("POST", `/rooms/${code}/votes`, {
    itemId,
    voterId: p.voterId,
    voterName: p.name,
    vote,
  });
}

/** Vote yes on every item as the given participant. */
export async function completeVoting(
  code: string,
  p: { voterId: string; name: string },
  items: { id: string }[]
) {
  for (const item of items) {
    const res = await submitVote(code, p, item.id);
    expect(res.status).toBe(201);
  }
}

export async function getParticipants(code: string, voterId?: string) {
  const qs = voterId ? `?voterId=${encodeURIComponent(voterId)}` : "";
  return api("GET", `/rooms/${code}/participants${qs}`);
}

export async function getRoom(code: string, voterId?: string) {
  const qs = voterId ? `?voterId=${encodeURIComponent(voterId)}` : "";
  return api("GET", `/rooms/${code}${qs}`);
}

export async function getResults(code: string, voterId?: string) {
  const qs = voterId ? `?voterId=${encodeURIComponent(voterId)}` : "";
  return api("GET", `/rooms/${code}/results${qs}`);
}
