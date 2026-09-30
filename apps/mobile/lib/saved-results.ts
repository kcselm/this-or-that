/**
 * Pure helpers for the local results history. Rooms (and their results) are
 * deleted from the server 48 hours after creation, so each device keeps its
 * own snapshot of every game it saw revealed. Storage lives in storage.ts.
 */
import type { ResultsResponse } from "./api";

export type RevealedResults = Extract<ResultsResponse, { revealed: true }>;
export type ResultsMode = "vote" | "rank" | "bracket" | "mlt" | "tier";

export type SavedResult = {
  code: string;
  topic: string;
  mode: ResultsMode;
  savedAt: string;
  data: RevealedResults;
};

export const RESULTS_RETENTION_DAYS = 30;
const RETENTION_MS = RESULTS_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function resultsMode(data: RevealedResults): ResultsMode {
  return "mode" in data ? data.mode : "vote";
}

export function toSavedResult(code: string, data: RevealedResults, now: Date): SavedResult {
  return {
    code: code.toUpperCase(),
    topic: data.topic,
    mode: resultsMode(data),
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

export const MODE_LABELS: Record<ResultsMode, string> = {
  vote: "Swipe Vote",
  rank: "Blind Rank",
  bracket: "Bracket",
  mlt: "Most Likely To",
  tier: "Tier List",
};

/** Short headline for a history row: the winner, where the mode has one. */
export function headline(data: RevealedResults): string | null {
  if (!("mode" in data)) return data.results[0]?.title ?? null;
  switch (data.mode) {
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
