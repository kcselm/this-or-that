// Child tables first: D1 enforces foreign keys, and matchups/votes reference
// items, so rooms and items must be deleted last.
const CHILD_TABLES = [
  "matchup_votes",
  "matchups",
  "mlt_votes",
  "tier_placements",
  "rankings",
  "votes",
  "draft_picks",
  "draft_seats",
  "participants",
  "items",
] as const;

// Rooms deleted per D1 batch. Each batch is a single transaction, so this caps
// how much one transaction does; the weekly cron runs batches until nothing
// expired is left (see purgeAllExpiredRooms).
export const PURGE_BATCH_SIZE = 200;

// Safety stop for one cron run: 50 batches is 10,000 rooms, far more than a
// week of use. Anything left over is picked up the following week.
const MAX_BATCHES_PER_RUN = 50;

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

/** Delete every expired room, a batch at a time. Returns how many rooms were deleted. */
export async function purgeAllExpiredRooms(db: D1Database, now: string): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const deleted = await purgeExpiredRooms(db, now);
    total += deleted;
    if (deleted < PURGE_BATCH_SIZE) break;
  }
  return total;
}
