/**
 * Pure helpers for the local results history. Rooms (and their results) are
 * deleted from the server 48 hours after creation, so each device keeps its
 * own snapshot of every game it saw revealed. Storage lives in storage.ts.
 */
import type { RevealedResults, VoteResults } from "./api";
import type { Mode } from "./modes";

export type { RevealedResults };

export type SavedResult = {
  code: string;
  topic: string;
  mode: Mode;
  savedAt: string;
  data: RevealedResults;
};

/** Swipe-vote results saved before the API started sending `mode`. */
type LegacyVoteResults = Omit<VoteResults, "mode">;

/** Fill in `mode` on snapshots saved by older versions of the app. */
export function withMode(data: RevealedResults | LegacyVoteResults): RevealedResults {
  return "mode" in data ? data : { ...data, mode: "vote" };
}

export const RESULTS_RETENTION_DAYS = 30;
const RETENTION_MS = RESULTS_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function toSavedResult(code: string, data: RevealedResults, now: Date): SavedResult {
  return {
    code: code.toUpperCase(),
    topic: data.topic,
    mode: data.mode,
    savedAt: now.toISOString(),
    data,
  };
}

/** Drop snapshots older than the retention window. */
export function pruneExpired(entries: SavedResult[], now: Date): SavedResult[] {
  const cutoff = now.getTime() - RETENTION_MS;
  return entries.filter((e) => new Date(e.savedAt).getTime() > cutoff);
}

/**
 * Insert or replace the snapshot for a room code. Re-viewing a room refreshes
 * its snapshot (and its retention clock) rather than adding a duplicate.
 */
export function upsertResult(entries: SavedResult[], entry: SavedResult): SavedResult[] {
  return [...entries.filter((e) => e.code !== entry.code), entry];
}

export function expiresAt(entry: SavedResult): Date {
  return new Date(new Date(entry.savedAt).getTime() + RETENTION_MS);
}

/** Short headline for a history row: the winner, where the mode has one. */
export function headline(data: RevealedResults): string | null {
  switch (data.mode) {
    case "vote":
      return data.results[0]?.title ?? null;
    case "bracket":
      return data.winner?.title ?? null;
    case "mlt":
      return data.leaderboard[0]?.name ?? null;
    case "tier": {
      const top = data.consensus.find((row) => row.items.length > 0);
      return top?.items[0]?.title ?? null;
    }
    case "rank":
      return null;
  }
}
