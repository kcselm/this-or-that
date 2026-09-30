export type ParticipantRow = {
  id: string;
  voter_id: string;
  voter_name: string;
};

/** Everyone who has joined the room, in join order. */
export async function listParticipants(db: D1Database, roomId: string): Promise<ParticipantRow[]> {
  const { results } = await db
    .prepare("SELECT id, voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC")
    .bind(roomId)
    .all<ParticipantRow>();
  return results;
}

export async function countParticipants(db: D1Database, roomId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function isParticipant(db: D1Database, roomId: string, voterId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .first();
  return row !== null;
}

/** A display name: a string of 1-30 characters once trimmed. */
export function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 30;
}

type RankedPlayer = { name: string; isYou: boolean; isCreator: boolean };

/** Order players on a results board: you first, then the host, then by name. */
export function comparePlayers(a: RankedPlayer, b: RankedPlayer): number {
  if (a.isYou !== b.isYou) return a.isYou ? -1 : 1;
  if (a.isCreator !== b.isCreator) return a.isCreator ? -1 : 1;
  return a.name.localeCompare(b.name);
}
