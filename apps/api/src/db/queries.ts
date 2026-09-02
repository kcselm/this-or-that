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

export type Item = {
  id: string;
  room_id: string;
  title: string;
  sort_order: number;
  added_by_voter_id: string | null;
  added_by_name: string | null;
  presentation_order: number | null;
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

export type Ranking = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  rank: number;
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

export async function getRankingsByRoomAndVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<Ranking[]> {
  const { results } = await db
    .prepare("SELECT * FROM rankings WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<Ranking>();
  return results;
}

export async function getRankingsByRoom(
  db: D1Database,
  roomId: string
): Promise<Ranking[]> {
  const { results } = await db
    .prepare("SELECT * FROM rankings WHERE room_id = ? ORDER BY voter_id, rank ASC")
    .bind(roomId)
    .all<Ranking>();
  return results;
}

export async function getNextRankItem(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<Item | null> {
  const item = await db
    .prepare(
      `SELECT i.* FROM items i
       WHERE i.room_id = ?
         AND i.presentation_order IS NOT NULL
         AND i.id NOT IN (SELECT item_id FROM rankings WHERE room_id = ? AND voter_id = ?)
       ORDER BY i.presentation_order ASC
       LIMIT 1`
    )
    .bind(roomId, roomId, voterId)
    .first<Item>();
  return item;
}

export type Matchup = {
  id: string;
  room_id: string;
  round: number;
  slot: number;
  item_a_id: string | null;
  item_b_id: string | null;
  winner_item_id: string | null;
  is_bye: number;
  decided_by_tiebreak: number;
  decided_at: string | null;
  created_at: string;
};

export type MatchupVote = {
  id: string;
  room_id: string;
  matchup_id: string;
  voter_id: string;
  voter_name: string;
  picked_item_id: string;
  created_at: string;
};

export async function getMatchupsByRoom(
  db: D1Database,
  roomId: string
): Promise<Matchup[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchups WHERE room_id = ? ORDER BY round ASC, slot ASC")
    .bind(roomId)
    .all<Matchup>();
  return results;
}

export async function getMatchupsByRoomAndRound(
  db: D1Database,
  roomId: string,
  round: number
): Promise<Matchup[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchups WHERE room_id = ? AND round = ? ORDER BY slot ASC")
    .bind(roomId, round)
    .all<Matchup>();
  return results;
}

export async function getMatchupVotesByRoom(
  db: D1Database,
  roomId: string
): Promise<MatchupVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchup_votes WHERE room_id = ?")
    .bind(roomId)
    .all<MatchupVote>();
  return results;
}

export async function getMatchupVotesByVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<MatchupVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM matchup_votes WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<MatchupVote>();
  return results;
}

// Returns the latest round number that has at least one matchup row.
// For a freshly-started bracket room this is 1. After R1 closes and R2 is
// created, this becomes 2. Returns 0 if no matchups exist.
export async function getCurrentRound(db: D1Database, roomId: string): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(round) as max_round FROM matchups WHERE room_id = ?")
    .bind(roomId)
    .first<{ max_round: number | null }>();
  return row?.max_round ?? 0;
}

export type MltVote = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  target_voter_id: string;
  target_voter_name: string;
  created_at: string;
};

export async function getMltVotesByRoom(
  db: D1Database,
  roomId: string
): Promise<MltVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM mlt_votes WHERE room_id = ?")
    .bind(roomId)
    .all<MltVote>();
  return results;
}

export async function getMltVotesByVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<MltVote[]> {
  const { results } = await db
    .prepare("SELECT * FROM mlt_votes WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<MltVote>();
  return results;
}

export type TierPlacement = {
  id: string;
  room_id: string;
  item_id: string;
  voter_id: string;
  voter_name: string;
  tier: "S" | "A" | "B" | "C" | "D";
  created_at: string;
};

export async function getTierPlacementsByRoom(
  db: D1Database,
  roomId: string
): Promise<TierPlacement[]> {
  const { results } = await db
    .prepare("SELECT * FROM tier_placements WHERE room_id = ?")
    .bind(roomId)
    .all<TierPlacement>();
  return results;
}

export async function getTierPlacementsByVoter(
  db: D1Database,
  roomId: string,
  voterId: string
): Promise<TierPlacement[]> {
  const { results } = await db
    .prepare("SELECT * FROM tier_placements WHERE room_id = ? AND voter_id = ?")
    .bind(roomId, voterId)
    .all<TierPlacement>();
  return results;
}
