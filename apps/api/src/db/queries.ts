export type Room = {
  id: string;
  code: string;
  topic: string;
  creator_voter_id: string;
  status: "open" | "voting" | "revealed";
  created_at: string;
  expires_at: string;
};

export type Item = {
  id: string;
  room_id: string;
  title: string;
  sort_order: number;
  created_at: string;
};

export type Vote = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  vote: "yes" | "no";
  created_at: string;
};

export async function getRoomByCode(db: D1Database, code: string): Promise<Room | null> {
  const room = await db
    .prepare("SELECT * FROM rooms WHERE code = ? AND expires_at > datetime('now')")
    .bind(code)
    .first<Room>();
  return room;
}

export async function getItemsByRoomId(db: D1Database, roomId: string): Promise<Item[]> {
  const { results } = await db
    .prepare("SELECT * FROM items WHERE room_id = ? ORDER BY sort_order ASC")
    .bind(roomId)
    .all<Item>();
  return results;
}

export async function getItemCount(db: D1Database, roomId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM items WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getVotesByRoomAndVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<Vote[]> {
  const { results } = await db
    .prepare("SELECT * FROM votes WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<Vote>();
  return results;
}
