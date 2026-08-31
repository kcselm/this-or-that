import { createRouter } from "../types";
import {
  getRoomByCode,
  getItemsByRoomId,
  getItemCount,
  getRankingsByRoom,
  getMatchupsByRoom,
  getMatchupsByRoomAndRound,
  getMatchupVotesByRoom,
  getCurrentRound,
  getTierPlacementsByRoom,
  type Room,
  type Matchup,
} from "../db/queries";
import { notFound, notCreator, invalidStatus, validationError } from "../lib/validation";

export const results = createRouter();

// GET /api/rooms/:code/status — Check voting progress
results.get("/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  if (room.mode === "bracket") {
    return getBracketStatus(c, db, room);
  }

  const totalItems = await getItemCount(db, room.id);

  let submissionsTable: string;
  let requiredCount: number;
  if (room.mode === "rank") {
    submissionsTable = "rankings";
    requiredCount = 5;
  } else if (room.mode === "mlt") {
    submissionsTable = "mlt_votes";
    requiredCount = totalItems;
  } else if (room.mode === "tier") {
    submissionsTable = "tier_placements";
    requiredCount = totalItems;
  } else {
    submissionsTable = "votes";
    requiredCount = totalItems;
  }

  const { results: participantRows } = await db
    .prepare(
      `SELECT p.voter_id, p.voter_name, COALESCE(s.submission_count, 0) as submission_count
       FROM participants p
       LEFT JOIN (
         SELECT voter_id, COUNT(*) as submission_count
         FROM ${submissionsTable} WHERE room_id = ?
         GROUP BY voter_id
       ) s ON p.voter_id = s.voter_id
       WHERE p.room_id = ?`
    )
    .bind(room.id, room.id)
    .all<{ voter_id: string; voter_name: string; submission_count: number }>();

  const voters = participantRows.map((row) => ({
    name: row.voter_name,
    completed: row.submission_count >= requiredCount,
  }));

  const completedCount = voters.filter((v) => v.completed).length;

  const totalVoters = voters.length;

  return Response.json({
    totalVoters,
    completedCount,
    isRevealed: room.status === "revealed",
    voters,
  });
});

async function getBracketStatus(c: any, db: D1Database, room: Room) {
  // For bracket: a participant is "complete" for the round when they have
  // voted on every real (non-bye) matchup in the current round. The
  // completedCount surfaces per-round progress, not whole-game progress.
  // The reveal trigger is room.status === 'revealed' (independent).
  const currentRound = room.status === "revealed" ? null : await getCurrentRound(db, room.id);

  const { results: participants } = await db
    .prepare(
      "SELECT voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ voter_id: string; voter_name: string }>();

  let voters: { name: string; completed: boolean }[];
  let completedCount: number;

  if (currentRound === null) {
    // Revealed — everyone counts as done.
    voters = participants.map((p) => ({ name: p.voter_name, completed: true }));
    completedCount = voters.length;
  } else {
    const roundMatchups = await getMatchupsByRoomAndRound(db, room.id, currentRound);
    const realIds = roundMatchups.filter((m) => !m.is_bye).map((m) => m.id);
    const required = realIds.length;

    if (required === 0) {
      // Degenerate (shouldn't happen): no real matchups in current round.
      voters = participants.map((p) => ({ name: p.voter_name, completed: true }));
      completedCount = voters.length;
    } else {
      const placeholders = realIds.map(() => "?").join(",");
      const { results: voteRows } = await db
        .prepare(
          `SELECT voter_id, COUNT(*) as c FROM matchup_votes
           WHERE room_id = ? AND matchup_id IN (${placeholders})
           GROUP BY voter_id`
        )
        .bind(room.id, ...realIds)
        .all<{ voter_id: string; c: number }>();

      const countByVoter = new Map(voteRows.map((r) => [r.voter_id, r.c]));
      voters = participants.map((p) => ({
        name: p.voter_name,
        completed: (countByVoter.get(p.voter_id) ?? 0) >= required,
      }));
      completedCount = voters.filter((v) => v.completed).length;
    }
  }

  return Response.json({
    totalVoters: voters.length,
    completedCount,
    isRevealed: room.status === "revealed",
    currentRound,
    voters,
  });
}

// GET /api/rooms/:code/results — Get final results
results.get("/:code/results", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  if (room.mode === "rank") {
    return getRankResults(c, db, room, voterId);
  }
  if (room.mode === "bracket") {
    return getBracketResults(c, db, room, voterId);
  }
  if (room.mode === "mlt") {
    return getMltResults(c, db, room, voterId);
  }
  if (room.mode === "tier") {
    return getTierResults(c, db, room, voterId);
  }
  return getVoteResults(c, db, room);
});

async function getVoteResults(c: any, db: D1Database, room: Room) {
  if (room.status !== "revealed") {
    // Return progress instead. Only registered participants count.
    const totalItems = await getItemCount(db, room.id);
    const result = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT v.voter_id FROM votes v
          JOIN participants p ON p.room_id = v.room_id AND p.voter_id = v.voter_id
          WHERE v.room_id = ? GROUP BY v.voter_id HAVING COUNT(*) >= ?
        )`
      )
      .bind(room.id, totalItems)
      .first<{ completed: number }>();

    const totalVoters = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();

    return Response.json({
      revealed: false,
      completedCount: result?.completed ?? 0,
      totalVoters: totalVoters?.count ?? 0,
    });
  }

  // Get items with vote tallies
  const items = await getItemsByRoomId(db, room.id);
  const { results: voteTallies } = await db
    .prepare(
      `SELECT item_id,
              SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) as yes_count,
              SUM(CASE WHEN vote = 'no' THEN 1 ELSE 0 END) as no_count
       FROM votes WHERE room_id = ? GROUP BY item_id`
    )
    .bind(room.id)
    .all<{ item_id: string; yes_count: number; no_count: number }>();

  const tallyMap = new Map(voteTallies.map((t) => [t.item_id, t]));

  // Count total voters
  const voterCount = await db
    .prepare("SELECT COUNT(DISTINCT voter_id) as count FROM votes WHERE room_id = ?")
    .bind(room.id)
    .first<{ count: number }>();

  const resultsData = items
    .map((item) => {
      const tally = tallyMap.get(item.id);
      const yesCount = tally?.yes_count ?? 0;
      const noCount = tally?.no_count ?? 0;
      const total = yesCount + noCount;
      return {
        itemId: item.id,
        title: item.title,
        yesCount,
        noCount,
        yesPercentage: total > 0 ? Math.round((yesCount / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.yesPercentage - a.yesPercentage);

  return Response.json({
    revealed: true,
    topic: room.topic,
    totalVoters: voterCount?.count ?? 0,
    results: resultsData,
  });
}

async function getRankResults(
  c: any,
  db: D1Database,
  room: Room,
  voterId: string | undefined
) {
  if (room.status !== "revealed") {
    const totalParticipants = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();
    const completed = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT r.voter_id FROM rankings r
          JOIN participants p ON p.room_id = r.room_id AND p.voter_id = r.voter_id
          WHERE r.room_id = ? GROUP BY r.voter_id HAVING COUNT(*) >= 5
        )`
      )
      .bind(room.id)
      .first<{ completed: number }>();

    return Response.json({
      revealed: false,
      mode: "rank",
      completedCount: completed?.completed ?? 0,
      totalVoters: totalParticipants?.count ?? 0,
    });
  }

  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const allRankings = await getRankingsByRoom(db, room.id);

  const participants = await db
    .prepare(
      "SELECT id, voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ id: string; voter_id: string; voter_name: string }>();

  type PlayerRow = {
    participantId: string;
    name: string;
    isCreator: boolean;
    isYou: boolean;
    rankings: { rank: number; itemId: string; title: string }[];
  };

  const byVoter = new Map<string, PlayerRow>();
  for (const p of participants.results) {
    byVoter.set(p.voter_id, {
      participantId: p.id,
      name: p.voter_name,
      isCreator: p.voter_id === room.creator_voter_id,
      isYou: !!voterId && p.voter_id === voterId,
      rankings: [],
    });
  }
  for (const r of allRankings) {
    const row = byVoter.get(r.voter_id);
    if (!row) continue;
    row.rankings.push({
      rank: r.rank,
      itemId: r.item_id,
      title: titleById.get(r.item_id) ?? "",
    });
  }

  const players: PlayerRow[] = [];
  for (const row of byVoter.values()) {
    if (row.rankings.length === 5) {
      row.rankings.sort((a, b) => a.rank - b.rank);
      players.push(row);
    }
  }

  players.sort((a, b) => {
    if (a.isYou !== b.isYou) return a.isYou ? -1 : 1;
    if (a.isCreator && !b.isCreator) return -1;
    if (b.isCreator && !a.isCreator) return 1;
    return a.name.localeCompare(b.name);
  });

  return Response.json({
    revealed: true,
    mode: "rank",
    topic: room.topic,
    players,
  });
}

async function getBracketResults(
  c: any,
  db: D1Database,
  room: Room,
  voterId: string | undefined
) {
  if (room.status !== "revealed") {
    // Mirror the rank "not yet revealed" shape, with mode discriminator.
    const currentRound = await getCurrentRound(db, room.id);
    const roundMatchups = await getMatchupsByRoomAndRound(db, room.id, currentRound);
    const realCount = roundMatchups.filter((m) => !m.is_bye).length;
    const participantsRow = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();
    const totalVoters = participantsRow?.count ?? 0;

    return Response.json({
      revealed: false,
      mode: "bracket",
      currentRound,
      totalVoters,
      completedCount: 0,
      totalThisRound: realCount,
    });
  }

  // Revealed: build full bracket payload with vote breakdowns.
  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const N = items.length;
  let P = 1;
  while (P < N) P *= 2;
  const totalRounds = Math.log2(P);

  const allMatchups = await getMatchupsByRoom(db, room.id);
  const allVotes = await getMatchupVotesByRoom(db, room.id);
  const votesByMatchup = new Map<string, { voterName: string; pickedItemId: string; isYou: boolean }[]>();
  for (const v of allVotes) {
    if (!votesByMatchup.has(v.matchup_id)) votesByMatchup.set(v.matchup_id, []);
    votesByMatchup.get(v.matchup_id)!.push({
      voterName: v.voter_name,
      pickedItemId: v.picked_item_id,
      isYou: !!voterId && v.voter_id === voterId,
    });
  }

  const byRound = new Map<number, Matchup[]>();
  for (const m of allMatchups) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }
  for (const list of byRound.values()) list.sort((a, b) => a.slot - b.slot);

  const rounds = [...byRound.keys()].sort((a, b) => a - b).map((round) => ({
    round,
    matchups: byRound.get(round)!.map((m) => ({
      id: m.id,
      slot: m.slot,
      itemA: m.item_a_id ? { id: m.item_a_id, title: titleById.get(m.item_a_id) ?? "" } : null,
      itemB: m.item_b_id ? { id: m.item_b_id, title: titleById.get(m.item_b_id) ?? "" } : null,
      winner: m.winner_item_id ? { id: m.winner_item_id, title: titleById.get(m.winner_item_id) ?? "" } : null,
      isBye: !!m.is_bye,
      decidedByTiebreak: !!m.decided_by_tiebreak,
      voteBreakdown: votesByMatchup.get(m.id) ?? [],
    })),
  }));

  // Winner is the winner of the final round's only matchup.
  const finalRound = byRound.get(totalRounds) ?? [];
  const finalMatchup = finalRound[0];
  const winner = finalMatchup?.winner_item_id
    ? { id: finalMatchup.winner_item_id, title: titleById.get(finalMatchup.winner_item_id) ?? "" }
    : null;

  return Response.json({
    revealed: true,
    mode: "bracket",
    topic: room.topic,
    totalRounds,
    winner,
    rounds,
  });
}

async function getMltResults(
  c: any,
  db: D1Database,
  room: Room,
  voterId: string | undefined
) {
  if (room.status !== "revealed") {
    const totalParticipants = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();

    const totalItems = await getItemCount(db, room.id);

    const completed = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT v.voter_id FROM mlt_votes v
          JOIN participants p ON p.room_id = v.room_id AND p.voter_id = v.voter_id
          WHERE v.room_id = ? GROUP BY v.voter_id HAVING COUNT(*) >= ?
        )`
      )
      .bind(room.id, totalItems)
      .first<{ completed: number }>();

    return Response.json({
      revealed: false,
      mode: "mlt",
      completedCount: completed?.completed ?? 0,
      totalVoters: totalParticipants?.count ?? 0,
    });
  }

  // Revealed: build per-prompt tallies + winners + leaderboard
  const items = await getItemsByRoomId(db, room.id);

  const { results: voteRows } = await db
    .prepare(
      "SELECT item_id, target_voter_id, target_voter_name FROM mlt_votes WHERE room_id = ?"
    )
    .bind(room.id)
    .all<{ item_id: string; target_voter_id: string; target_voter_name: string }>();

  const { results: participants } = await db
    .prepare(
      "SELECT id, voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ id: string; voter_id: string; voter_name: string }>();

  type ItemTallies = Map<string, { name: string; count: number }>;
  const talliesByItem = new Map<string, ItemTallies>();
  for (const item of items) talliesByItem.set(item.id, new Map());
  for (const v of voteRows) {
    const tallies = talliesByItem.get(v.item_id);
    if (!tallies) continue;
    const existing = tallies.get(v.target_voter_id);
    if (existing) {
      existing.count += 1;
    } else {
      tallies.set(v.target_voter_id, { name: v.target_voter_name, count: 1 });
    }
  }

  const winsByVoter = new Map<string, { name: string; wins: number }>();
  for (const p of participants) {
    winsByVoter.set(p.voter_id, { name: p.voter_name, wins: 0 });
  }

  const prompts = items.map((item) => {
    const itemTallies = talliesByItem.get(item.id) ?? new Map();

    // Internal tallies stay keyed by voter_id; only the public participant id
    // leaves the server.
    const fullTallies = participants.map((p) => {
      const t = itemTallies.get(p.voter_id);
      return {
        targetVoterId: p.voter_id,
        targetParticipantId: p.id,
        name: t?.name ?? p.voter_name,
        count: t?.count ?? 0,
      };
    });

    fullTallies.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    const totalVotes = fullTallies.reduce((sum, t) => sum + t.count, 0);
    const topCount = fullTallies[0]?.count ?? 0;
    const topTallies =
      topCount === 0 ? [] : fullTallies.filter((t) => t.count === topCount);

    for (const w of topTallies) {
      const row = winsByVoter.get(w.targetVoterId);
      if (row) row.wins += 1;
    }

    return {
      itemId: item.id,
      text: item.title,
      sortOrder: item.sort_order,
      tallies: fullTallies.map((t) => ({
        targetParticipantId: t.targetParticipantId,
        name: t.name,
        count: t.count,
      })),
      winners: topTallies.map((t) => ({
        participantId: t.targetParticipantId,
        name: t.name,
      })),
      totalVotes,
    };
  });

  const leaderboard = participants
    .map((p) => ({
      participantId: p.id,
      name: winsByVoter.get(p.voter_id)?.name ?? p.voter_name,
      wins: winsByVoter.get(p.voter_id)?.wins ?? 0,
      isYou: !!voterId && p.voter_id === voterId,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    });

  return Response.json({
    revealed: true,
    mode: "mlt",
    topic: room.topic,
    prompts,
    leaderboard,
  });
}

const TIER_ORDER = ["S", "A", "B", "C", "D"] as const;
const TIER_VALUE: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
const VALUE_TIER: Record<number, "S" | "A" | "B" | "C" | "D"> = {
  5: "S",
  4: "A",
  3: "B",
  2: "C",
  1: "D",
};

async function getTierResults(
  c: any,
  db: D1Database,
  room: Room,
  voterId: string | undefined
) {
  if (room.status !== "revealed") {
    const totalParticipants = await db
      .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();
    const totalItems = await getItemCount(db, room.id);
    const completed = await db
      .prepare(
        `SELECT COUNT(*) as completed FROM (
          SELECT t.voter_id FROM tier_placements t
          JOIN participants p ON p.room_id = t.room_id AND p.voter_id = t.voter_id
          WHERE t.room_id = ? GROUP BY t.voter_id HAVING COUNT(*) >= ?
        )`
      )
      .bind(room.id, totalItems)
      .first<{ completed: number }>();

    return Response.json({
      revealed: false,
      mode: "tier",
      completedCount: completed?.completed ?? 0,
      totalVoters: totalParticipants?.count ?? 0,
    });
  }

  const items = await getItemsByRoomId(db, room.id); // sorted by sort_order ASC
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const orderById = new Map(items.map((i) => [i.id, i.sort_order]));
  const allPlacements = await getTierPlacementsByRoom(db, room.id);

  const participants = await db
    .prepare(
      "SELECT id, voter_id, voter_name FROM participants WHERE room_id = ? ORDER BY joined_at ASC"
    )
    .bind(room.id)
    .all<{ id: string; voter_id: string; voter_name: string }>();

  // --- Consensus: average each item's tier value across all placements. ---
  const sumByItem = new Map<string, { sum: number; count: number }>();
  for (const p of allPlacements) {
    const acc = sumByItem.get(p.item_id) ?? { sum: 0, count: 0 };
    acc.sum += TIER_VALUE[p.tier] ?? 0;
    acc.count += 1;
    sumByItem.set(p.item_id, acc);
  }

  type ConsensusItem = { itemId: string; title: string; average: number; tier: string };
  const consensusItems: ConsensusItem[] = [];
  for (const item of items) {
    const acc = sumByItem.get(item.id);
    if (!acc || acc.count === 0) continue; // no placements (shouldn't happen once revealed)
    const average = acc.sum / acc.count;
    const tier = VALUE_TIER[Math.round(average)] ?? "D";
    consensusItems.push({ itemId: item.id, title: item.title, average, tier });
  }

  const consensus = TIER_ORDER.map((tier) => ({
    tier,
    items: consensusItems
      .filter((ci) => ci.tier === tier)
      .sort((a, b) => {
        if (b.average !== a.average) return b.average - a.average;
        return (orderById.get(a.itemId) ?? 0) - (orderById.get(b.itemId) ?? 0);
      })
      .map((ci) => ({ itemId: ci.itemId, title: ci.title, average: ci.average })),
  }));

  // --- Per-player boards. ---
  type PlayerRow = {
    participantId: string;
    name: string;
    isCreator: boolean;
    isYou: boolean;
    placements: { itemId: string; title: string; tier: string }[];
  };
  const byVoter = new Map<string, PlayerRow>();
  for (const p of participants.results) {
    byVoter.set(p.voter_id, {
      participantId: p.id,
      name: p.voter_name,
      isCreator: p.voter_id === room.creator_voter_id,
      isYou: !!voterId && p.voter_id === voterId,
      placements: [],
    });
  }
  for (const p of allPlacements) {
    const row = byVoter.get(p.voter_id);
    if (!row) continue;
    row.placements.push({
      itemId: p.item_id,
      title: titleById.get(p.item_id) ?? "",
      tier: p.tier,
    });
  }

  const players: PlayerRow[] = [];
  for (const row of byVoter.values()) {
    if (row.placements.length === items.length) {
      row.placements.sort(
        (a, b) => (orderById.get(a.itemId) ?? 0) - (orderById.get(b.itemId) ?? 0)
      );
      players.push(row);
    }
  }

  players.sort((a, b) => {
    if (a.isYou !== b.isYou) return a.isYou ? -1 : 1;
    if (a.isCreator && !b.isCreator) return -1;
    if (b.isCreator && !a.isCreator) return 1;
    return a.name.localeCompare(b.name);
  });

  return Response.json({
    revealed: true,
    mode: "tier",
    topic: room.topic,
    consensus,
    players,
  });
}

// POST /api/rooms/:code/reveal — Creator force-reveals results
results.post("/:code/reveal", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { creatorVoterId } = body;

  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.status !== "voting") return invalidStatus("Room must be in voting status to reveal");

  await db
    .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ?")
    .bind(room.id)
    .run();

  return Response.json({ success: true, status: "revealed" });
});
