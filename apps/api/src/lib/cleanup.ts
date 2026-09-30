// Child tables first: D1 enforces foreign keys, and matchups/votes reference
// items, so rooms and items must be deleted last.
const CHILD_TABLES = [
  "matchup_votes",
  "matchups",
  "mlt_votes",
  "tier_placements",
  "rankings",
  "votes",
  "participants",
  "items",
] as const;

// Rooms deleted per run. Each run is one D1 batch (a single transaction), so
// this caps how much work one cron invocation does. The cron runs hourly, which
// is far more capacity than rooms are created.
export const PURGE_BATCH_SIZE = 200;

/** Delete up to PURGE_BATCH_SIZE expired rooms and all their rows. Returns how many rooms were deleted. */
export async function purgeExpiredRooms(db: D1Database, now: string): Promise<number> {
  // Every statement selects the same rooms: the batch runs as one transaction
  // and the rooms table isn't touched until the last statement.
  const expired = `SELECT id FROM rooms WHERE expires_at <= ?1 ORDER BY expires_at, id LIMIT ${PURGE_BATCH_SIZE}`;

  const statements = CHILD_TABLES.map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE room_id IN (${expired})`).bind(now)
  );
  statements.push(db.prepare(`DELETE FROM rooms WHERE id IN (${expired})`).bind(now));

  const results = await db.batch(statements);
  return results[results.length - 1].meta.changes ?? 0;
}
