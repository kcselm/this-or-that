import { getItemsByRoomId, getMltVotesByVoter } from "../db/queries";
import { listParticipants } from "../lib/participants";
import { submissionProgress } from "./progress";
import type { ModeHandler } from "./types";

// Most Likely To: for each prompt, everyone votes for the player who fits it
// best. Players are both the voters and the candidates.
export const mltMode: ModeHandler = {
  submitPath: "/mlt-votes",

  showItems: (room, isCreator) => room.status !== "open" || isCreator,

  async myState(db, room, voterId) {
    const votes = await getMltVotesByVoter(db, room.id, voterId);
    const myMltVotes: Record<string, string> = {};
    if (votes.length > 0) {
      // Speak public participant ids to the client, never raw voter ids.
      const participantIdByVoter = new Map(
        (await listParticipants(db, room.id)).map((p) => [p.voter_id, p.id])
      );
      for (const v of votes) {
        const targetId = participantIdByVoter.get(v.target_voter_id);
        if (targetId) myMltVotes[v.item_id] = targetId;
      }
    }
    return { myMltVotes };
  },

  progress: (db, room) => submissionProgress(db, room, "mlt_votes"),

  async results(db, room, voterId) {
    const items = await getItemsByRoomId(db, room.id);
    const participants = await listParticipants(db, room.id);
    const { results: votes } = await db
      .prepare("SELECT item_id, target_voter_id FROM mlt_votes WHERE room_id = ?")
      .bind(room.id)
      .all<{ item_id: string; target_voter_id: string }>();

    // Tallies stay keyed by voter_id internally; only public participant ids
    // leave the server.
    const votesFor = new Map<string, number>(); // `${itemId}:${targetVoterId}` -> count
    for (const v of votes) {
      const key = `${v.item_id}:${v.target_voter_id}`;
      votesFor.set(key, (votesFor.get(key) ?? 0) + 1);
    }
    const winsByVoter = new Map<string, number>();

    const prompts = items.map((item) => {
      const tallies = participants
        .map((p) => ({
          voterId: p.voter_id,
          targetParticipantId: p.id,
          name: p.voter_name,
          count: votesFor.get(`${item.id}:${p.voter_id}`) ?? 0,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      // Everyone tied for the most votes wins the prompt.
      const topCount = tallies[0]?.count ?? 0;
      const winners = topCount === 0 ? [] : tallies.filter((t) => t.count === topCount);
      for (const w of winners) winsByVoter.set(w.voterId, (winsByVoter.get(w.voterId) ?? 0) + 1);

      return {
        itemId: item.id,
        text: item.title,
        sortOrder: item.sort_order,
        tallies: tallies.map(({ targetParticipantId, name, count }) => ({
          targetParticipantId,
          name,
          count,
        })),
        winners: winners.map((w) => ({ participantId: w.targetParticipantId, name: w.name })),
        totalVotes: tallies.reduce((sum, t) => sum + t.count, 0),
      };
    });

    const leaderboard = participants
      .map((p) => ({
        participantId: p.id,
        name: p.voter_name,
        wins: winsByVoter.get(p.voter_id) ?? 0,
        isYou: !!voterId && p.voter_id === voterId,
      }))
      .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

    return { prompts, leaderboard };
  },
};
