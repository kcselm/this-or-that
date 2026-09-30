import { getItemCount, type Room } from "../db/queries";
import type { Progress } from "./types";

/** Tables holding one row per voter per item, for the modes that work that way. */
export type SubmissionTable = "votes" | "rankings" | "mlt_votes" | "tier_placements";

/**
 * Progress for modes where a voter is done once they have a row for every
 * item. Only registered participants are listed, so stray rows from
 * non-participants can never count toward the reveal.
 */
export async function submissionProgress(
  db: D1Database,
  room: Room,
  table: SubmissionTable
): Promise<Progress> {
  const totalItems = await getItemCount(db, room.id);
  const { results } = await db
    .prepare(
      `SELECT p.voter_id, p.voter_name, COALESCE(s.submitted, 0) as submitted
       FROM participants p
       LEFT JOIN (
         SELECT voter_id, COUNT(*) as submitted FROM ${table} WHERE room_id = ? GROUP BY voter_id
       ) s ON p.voter_id = s.voter_id
       WHERE p.room_id = ?
       ORDER BY p.joined_at ASC`
    )
    .bind(room.id, room.id)
    .all<{ voter_id: string; voter_name: string; submitted: number }>();

  return {
    voters: results.map((r) => ({
      voterId: r.voter_id,
      name: r.voter_name,
      completed: r.submitted >= totalItems,
    })),
  };
}

export function completedCount(progress: Progress): number {
  return progress.voters.filter((v) => v.completed).length;
}

/** Shuffle the room's items (Fisher-Yates) and return their ids. */
export async function shuffledItemIds(db: D1Database, roomId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM items WHERE room_id = ? ORDER BY sort_order ASC")
    .bind(roomId)
    .all<{ id: string }>();
  const ids = results.map((r) => r.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}
