import { createRouter } from "../types";
import {
  getRoomByCode,
  getItemsByRoomId,
  getMatchupsByRoom,
  getMatchupsByRoomAndRound,
  getMatchupVotesByRoom,
  getMatchupVotesByVoter,
  getCurrentRound,
  type Matchup,
} from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";

export const bracket = createRouter();

// GET /api/rooms/:code/bracket?voterId=X
// Returns past + current rounds. Future rounds aren't materialized yet
// (they're created server-side when the previous round closes), so a curious
// client cannot peek at them.
bracket.get("/:code/bracket", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "bracket") {
    return invalidStatus("This room is not a bracket room");
  }
  if (room.status === "open") {
    return invalidStatus("Bracket hasn't started yet");
  }

  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const N = items.length;
  let P = 1;
  while (P < N) P *= 2;
  const totalRounds = Math.log2(P); // integer when N >= 1

  const allMatchups = await getMatchupsByRoom(db, room.id);
  const currentRound = room.status === "revealed" ? null : await getCurrentRound(db, room.id);

  // Group matchups by round.
  const byRound = new Map<number, Matchup[]>();
  for (const m of allMatchups) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }
  for (const list of byRound.values()) list.sort((a, b) => a.slot - b.slot);

  // Vote breakdowns ONLY for past (decided) rounds, never for the current
  // round (anti-strategy). When the room is revealed, currentRound is null
  // so all rounds count as past.
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

  const rounds = [...byRound.keys()].sort((a, b) => a - b).map((round) => {
    const matchups = byRound.get(round)!.map((m) => {
      const isPastRound = currentRound === null || round < currentRound;
      const includeBreakdown = isPastRound && m.winner_item_id !== null;
      return {
        id: m.id,
        slot: m.slot,
        itemA: m.item_a_id
          ? { id: m.item_a_id, title: titleById.get(m.item_a_id) ?? "" }
          : null,
        itemB: m.item_b_id
          ? { id: m.item_b_id, title: titleById.get(m.item_b_id) ?? "" }
          : null,
        winner: m.winner_item_id
          ? { id: m.winner_item_id, title: titleById.get(m.winner_item_id) ?? "" }
          : null,
        isBye: !!m.is_bye,
        decidedByTiebreak: !!m.decided_by_tiebreak,
        voteBreakdown: includeBreakdown ? (votesByMatchup.get(m.id) ?? []) : undefined,
      };
    });
    return { round, matchups };
  });

  // My votes across all rounds (used by client to repaint and to skip
  // already-voted matchups when resuming mid-round).
  const myVotes: Record<string, string> = {};
  if (voterId) {
    const mine = await getMatchupVotesByVoter(db, room.id, voterId);
    for (const v of mine) myVotes[v.matchup_id] = v.picked_item_id;
  }

  return Response.json({
    currentRound,
    totalRounds,
    rounds,
    myVotes,
  });
});

// POST /api/rooms/:code/matchup-votes
bracket.post("/:code/matchup-votes", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { matchupId, voterId, voterName, pickedItemId } = body;

  if (!matchupId || typeof matchupId !== "string") {
    return validationError("matchupId is required");
  }
  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!voterName || typeof voterName !== "string" || voterName.length < 1 || voterName.length > 30) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (!pickedItemId || typeof pickedItemId !== "string") {
    return validationError("pickedItemId is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "bracket") {
    return validationError("This room is not a bracket room");
  }
  if (room.status !== "voting") {
    return invalidStatus("Matchup votes can only be submitted while voting is open");
  }

  // Verify participant.
  const participant = await db
    .prepare("SELECT id FROM participants WHERE room_id = ? AND voter_id = ?")
    .bind(room.id, voterId)
    .first();
  if (!participant) return validationError("You must join the room before voting");

  // Verify matchup belongs to this room, is in the current round, isn't a bye,
  // and pickedItemId is one of the two competitors.
  const matchup = await db
    .prepare("SELECT * FROM matchups WHERE id = ? AND room_id = ?")
    .bind(matchupId, room.id)
    .first<Matchup>();
  if (!matchup) return validationError("Matchup not found in this room");
  if (matchup.is_bye) return validationError("Cannot vote on a bye matchup");

  const currentRound = await getCurrentRound(db, room.id);
  if (matchup.round !== currentRound) {
    return invalidStatus("That matchup is not in the current round");
  }
  if (pickedItemId !== matchup.item_a_id && pickedItemId !== matchup.item_b_id) {
    return validationError("pickedItemId must be one of the matchup's two items");
  }

  // Insert vote. UNIQUE(matchup_id, voter_id) catches double-votes.
  try {
    await db
      .prepare(
        "INSERT INTO matchup_votes (id, room_id, matchup_id, voter_id, voter_name, picked_item_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), room.id, matchupId, voterId, voterName.trim(), pickedItemId)
      .run();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE")) {
      return validationError("You have already voted on this matchup");
    }
    throw e;
  }

  // Try to advance the round (idempotent — safe to call concurrently).
  await maybeAdvanceRound(db, room.id, currentRound);

  // Compute progress for this voter in the current round.
  const currentRoundMatchups = await getMatchupsByRoomAndRound(db, room.id, currentRound);
  const realMatchupIds = new Set(
    currentRoundMatchups.filter((m) => !m.is_bye).map((m) => m.id)
  );
  const myVotes = await getMatchupVotesByVoter(db, room.id, voterId);
  const votedThisRound = myVotes.filter((v) => realMatchupIds.has(v.matchup_id)).length;

  return Response.json(
    {
      success: true,
      progress: { votedThisRound, totalThisRound: realMatchupIds.size },
    },
    { status: 201 }
  );
});

// If all participants have voted on every real matchup in the round, decide
// each matchup (majority, coin-flip on ties), then either create next-round
// matchups or transition to 'revealed'.
async function maybeAdvanceRound(db: D1Database, roomId: string, round: number) {
  const matchups = await getMatchupsByRoomAndRound(db, roomId, round);
  const realMatchups = matchups.filter((m) => !m.is_bye);
  if (realMatchups.length === 0) {
    // All byes (shouldn't happen — Round 1 always has >=1 real matchup for
    // 4-16 items). Nothing to advance via voting.
    return;
  }

  const participantRow = await db
    .prepare("SELECT COUNT(*) as count FROM participants WHERE room_id = ?")
    .bind(roomId)
    .first<{ count: number }>();
  const participantCount = participantRow?.count ?? 0;
  if (participantCount < 2) return; // need at least 2 players to ever close a round

  // For each real matchup, count votes. The round is ready when every real
  // matchup has at least `participantCount` votes from distinct voters.
  // (UNIQUE(matchup,voter) means each row is a distinct voter.)
  const voteCounts = await db
    .prepare(
      `SELECT matchup_id, COUNT(*) as c
       FROM matchup_votes
       WHERE room_id = ? AND matchup_id IN (${realMatchups.map(() => "?").join(",")})
       GROUP BY matchup_id`
    )
    .bind(roomId, ...realMatchups.map((m) => m.id))
    .all<{ matchup_id: string; c: number }>();

  const countByMatchup = new Map(voteCounts.results.map((r) => [r.matchup_id, r.c]));
  for (const m of realMatchups) {
    if ((countByMatchup.get(m.id) ?? 0) < participantCount) return; // not ready
  }

  // All real matchups are ready. Decide each one (skip if already decided —
  // makes this idempotent under concurrent triggers).
  const decisions: { matchupId: string; winnerId: string; tiebreak: boolean }[] = [];
  for (const m of realMatchups) {
    if (m.winner_item_id) continue; // already decided

    const tallies = await db
      .prepare(
        "SELECT picked_item_id, COUNT(*) as c FROM matchup_votes WHERE matchup_id = ? GROUP BY picked_item_id"
      )
      .bind(m.id)
      .all<{ picked_item_id: string; c: number }>();

    let aCount = 0, bCount = 0;
    for (const t of tallies.results) {
      if (t.picked_item_id === m.item_a_id) aCount = t.c;
      else if (t.picked_item_id === m.item_b_id) bCount = t.c;
    }

    let winnerId: string;
    let tiebreak = false;
    if (aCount > bCount) {
      winnerId = m.item_a_id!;
    } else if (bCount > aCount) {
      winnerId = m.item_b_id!;
    } else {
      // Coin flip
      tiebreak = true;
      winnerId = Math.random() < 0.5 ? m.item_a_id! : m.item_b_id!;
    }
    decisions.push({ matchupId: m.id, winnerId, tiebreak });
  }

  if (decisions.length === 0) {
    // Another concurrent call already decided everything. Still need to check
    // whether to create next round (skipped below if next-round rows exist).
  }

  const nowIso = new Date().toISOString();
  const statements: any[] = decisions.map((d) =>
    db
      .prepare(
        "UPDATE matchups SET winner_item_id = ?, decided_by_tiebreak = ?, decided_at = ? WHERE id = ? AND winner_item_id IS NULL"
      )
      .bind(d.winnerId, d.tiebreak ? 1 : 0, nowIso, d.matchupId)
  );

  // Build next round, or close the bracket.
  const nextRoundExists = await db
    .prepare("SELECT 1 FROM matchups WHERE room_id = ? AND round = ? LIMIT 1")
    .bind(roomId, round + 1)
    .first();

  if (!nextRoundExists) {
    // Pair winners of this round into next-round matchups.
    // Re-fetch winners (including byes and just-decided real matchups).
    const allThisRound = await getMatchupsByRoomAndRound(db, roomId, round);
    const winnerBySlot = new Map<number, string>();
    for (const m of allThisRound) {
      if (m.winner_item_id) winnerBySlot.set(m.slot, m.winner_item_id);
    }
    for (const d of decisions) {
      const slot = realMatchups.find((m) => m.id === d.matchupId)!.slot;
      winnerBySlot.set(slot, d.winnerId);
    }

    const nextSlotCount = Math.floor(allThisRound.length / 2);

    if (nextSlotCount === 0) {
      // This round was the final — transition room to revealed.
      statements.push(
        db
          .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
          .bind(roomId)
      );
    } else {
      for (let slot = 0; slot < nextSlotCount; slot++) {
        const winnerA = winnerBySlot.get(slot * 2)!;
        const winnerB = winnerBySlot.get(slot * 2 + 1)!;
        statements.push(
          db
            .prepare(
              "INSERT INTO matchups (id, room_id, round, slot, item_a_id, item_b_id, is_bye) VALUES (?, ?, ?, ?, ?, ?, 0)"
            )
            .bind(crypto.randomUUID(), roomId, round + 1, slot, winnerA, winnerB)
        );
      }
    }
  }

  if (statements.length > 0) {
    try {
      await db.batch(statements);
    } catch (e: any) {
      // Concurrent advance race: another caller already created the next
      // round (UNIQUE(room_id, round, slot)) or wrote the same winners.
      // Swallow the constraint violation — the round is consistent either way.
      const msg = String(e?.message ?? e);
      if (!msg.includes("UNIQUE")) throw e;
    }
  }
}
