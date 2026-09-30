import { planRound, totalRoundsFor } from "@tot/shared";
import {
  getCurrentRound,
  getItemsByRoomId,
  getMatchupsByRoom,
  getMatchupsByRoomAndRound,
  getMatchupVotesByRoom,
  insertMatchupStatement,
  nowIso,
  type Matchup,
  type Room,
} from "../db/queries";
import { listParticipants } from "../lib/participants";
import { shuffledItemIds } from "./progress";
import type { ModeHandler, Progress } from "./types";

// Bracket: items face off in rounds of head-to-head matchups. Each round is
// created server-side once everyone has voted on the previous one, and the
// room reveals itself when the final is decided.
export const bracketMode: ModeHandler = {
  submitPath: "/matchup-votes",

  showItems: (room, isCreator) => room.status === "open" && isCreator,

  // Seed round 1 from a shuffled field, with a rolling bye when N is odd.
  async onStart(db, room) {
    const ids = await shuffledItemIds(db, room.id);
    const now = nowIso();
    await db.batch(planRound(ids, 1).map((planned) => insertMatchupStatement(db, room.id, 1, planned, now)));
  },

  progress: bracketProgress,

  async results(db, room, voterId) {
    const { rounds, totalRounds, titleById, matchups } = await bracketRounds(db, room, voterId, () => true);

    // The champion is the winner of the final round's only matchup. A
    // force-reveal before the final leaves this null.
    const final = matchups.find((m) => m.round === totalRounds);
    const winner = final?.winner_item_id
      ? { id: final.winner_item_id, title: titleById.get(final.winner_item_id) ?? "" }
      : null;

    return { totalRounds, winner, rounds };
  },
};

// A participant is done with the round once they've voted on every real
// (non-bye) matchup in it. This is per-round progress, not whole-game:
// rounds advance on their own, and the reveal happens when the final closes.
async function bracketProgress(db: D1Database, room: Room): Promise<Progress> {
  const participants = await listParticipants(db, room.id);
  const everyoneDone = (): Progress => ({
    voters: participants.map((p) => ({ voterId: p.voter_id, name: p.voter_name, completed: true })),
    extra: { currentRound: null, totalThisRound: 0 },
  });

  if (room.status === "revealed") return everyoneDone();

  const currentRound = await getCurrentRound(db, room.id);
  const realIds = (await getMatchupsByRoomAndRound(db, room.id, currentRound))
    .filter((m) => !m.is_bye)
    .map((m) => m.id);

  if (realIds.length === 0) {
    // Only before the bracket starts: every started round has a real matchup.
    return { ...everyoneDone(), extra: { currentRound, totalThisRound: 0 } };
  }

  const { results: voteRows } = await db
    .prepare(
      `SELECT voter_id, COUNT(*) as c FROM matchup_votes
       WHERE room_id = ? AND matchup_id IN (${realIds.map(() => "?").join(",")})
       GROUP BY voter_id`
    )
    .bind(room.id, ...realIds)
    .all<{ voter_id: string; c: number }>();
  const votesByVoter = new Map(voteRows.map((r) => [r.voter_id, r.c]));

  return {
    voters: participants.map((p) => ({
      voterId: p.voter_id,
      name: p.voter_name,
      completed: (votesByVoter.get(p.voter_id) ?? 0) >= realIds.length,
    })),
    extra: { currentRound, totalThisRound: realIds.length },
  };
}

export type VoteBreakdown = { voterName: string; pickedItemId: string; isYou: boolean }[];

/**
 * Every created round with its matchups, as the API returns them. Only rounds
 * up to the current one exist, so this can never leak future pairings.
 * `showBreakdown` decides which matchups include who voted for what.
 */
export async function bracketRounds(
  db: D1Database,
  room: Room,
  voterId: string | undefined,
  showBreakdown: (m: Matchup) => boolean
) {
  const items = await getItemsByRoomId(db, room.id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const item = (id: string | null) => (id ? { id, title: titleById.get(id) ?? "" } : null);

  const matchups = await getMatchupsByRoom(db, room.id); // round, slot order
  const votes = await getMatchupVotesByRoom(db, room.id);
  const votesByMatchup = new Map<string, VoteBreakdown>();
  for (const v of votes) {
    const list = votesByMatchup.get(v.matchup_id) ?? [];
    list.push({ voterName: v.voter_name, pickedItemId: v.picked_item_id, isYou: !!voterId && v.voter_id === voterId });
    votesByMatchup.set(v.matchup_id, list);
  }

  const roundNumbers = [...new Set(matchups.map((m) => m.round))];
  const rounds = roundNumbers.map((round) => ({
    round,
    matchups: matchups
      .filter((m) => m.round === round)
      .map((m) => ({
        id: m.id,
        slot: m.slot,
        itemA: item(m.item_a_id),
        itemB: item(m.item_b_id),
        winner: item(m.winner_item_id),
        isBye: !!m.is_bye,
        decidedByTiebreak: !!m.decided_by_tiebreak,
        voteBreakdown: showBreakdown(m) ? (votesByMatchup.get(m.id) ?? []) : undefined,
      })),
  }));

  return { rounds, totalRounds: totalRoundsFor(items.length), titleById, matchups };
}
