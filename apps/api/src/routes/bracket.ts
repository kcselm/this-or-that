import { planRound, MODE_RULES } from "@tot/shared";
import { createRouter } from "../types";
import {
  getRoomByCode,
  getMatchupsByRoomAndRound,
  getMatchupVotesByVoter,
  getCurrentRound,
  insertMatchupStatement,
  nowIso,
  type Matchup,
} from "../db/queries";
import { notFound, invalidStatus, validationError } from "../lib/validation";
import { countParticipants, isParticipant, isValidName } from "../lib/participants";
import { wrongModeError } from "../modes";
import { bracketRounds } from "../modes/bracket";

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

  const currentRound = room.status === "revealed" ? null : await getCurrentRound(db, room.id);

  // Vote breakdowns ONLY for decided matchups in past rounds, never for the
  // current round (anti-strategy). Once revealed, every round is past.
  const { rounds, totalRounds } = await bracketRounds(
    db,
    room,
    voterId,
    (m) => (currentRound === null || m.round < currentRound) && m.winner_item_id !== null
  );

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
  if (!isValidName(voterName)) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (!pickedItemId || typeof pickedItemId !== "string") {
    return validationError("pickedItemId is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  const wrongMode = wrongModeError(room, "bracket");
  if (wrongMode) return wrongMode;
  if (room.status !== "voting") {
    return invalidStatus("Matchup votes can only be submitted while voting is open");
  }

  if (!(await isParticipant(db, room.id, voterId))) {
    return validationError("You must join the room before voting");
  }

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
  } catch (e: unknown) {
    if (String((e as Error)?.message ?? e).includes("UNIQUE")) {
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

  const participantCount = await countParticipants(db, roomId);
  // A round only closes once there are enough players to ever reveal.
  if (participantCount < MODE_RULES.bracket.minPlayersToReveal) return;

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

  // decisions is empty when a concurrent call already decided everything; the
  // next round still needs creating unless that call created it too.
  const now = nowIso();
  const statements: D1PreparedStatement[] = decisions.map((d) =>
    db
      .prepare(
        "UPDATE matchups SET winner_item_id = ?, decided_by_tiebreak = ?, decided_at = ? WHERE id = ? AND winner_item_id IS NULL"
      )
      .bind(d.winnerId, d.tiebreak ? 1 : 0, now, d.matchupId)
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

    // Winners in slot order are the next round's competitors in bracket
    // order. Rolling byes: an odd winner count sits one item out.
    const winners = allThisRound.map((m) => winnerBySlot.get(m.slot)!);
    const nextRound = planRound(winners, round + 1);

    if (nextRound.length === 0) {
      // A lone winner means this round was the final — reveal the room.
      statements.push(
        db
          .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
          .bind(roomId)
      );
    } else {
      for (const planned of nextRound) {
        statements.push(insertMatchupStatement(db, roomId, round + 1, planned, now));
      }
    }
  }

  if (statements.length > 0) {
    try {
      await db.batch(statements);
    } catch (e: unknown) {
      // Concurrent advance race: another caller already created the next
      // round (UNIQUE(room_id, round, slot)) or wrote the same winners.
      // Swallow the constraint violation — the round is consistent either way.
      if (!String((e as Error)?.message ?? e).includes("UNIQUE")) throw e;
    }
  }
}
