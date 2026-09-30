import { getItemsByRoomId, getVotesByRoomAndVoter } from "../db/queries";
import { submissionProgress } from "./progress";
import type { ModeHandler } from "./types";

// Swipe vote: everyone says yes or no to every item; ranked by yes-percentage.
export const voteMode: ModeHandler = {
  submitPath: "/votes",

  // Participants see the list while it's open only if they can suggest items.
  showItems: (room, isCreator) =>
    room.status !== "open" || isCreator || !!room.allow_suggestions,

  async myState(db, room, voterId) {
    const votes = await getVotesByRoomAndVoter(db, room.id, voterId);
    return { myVotes: Object.fromEntries(votes.map((v) => [v.item_id, v.vote])) };
  },

  progress: (db, room) => submissionProgress(db, room, "votes"),

  async results(db, room) {
    const items = await getItemsByRoomId(db, room.id);
    const { results: tallies } = await db
      .prepare(
        `SELECT item_id,
                SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) as yes_count,
                SUM(CASE WHEN vote = 'no' THEN 1 ELSE 0 END) as no_count
         FROM votes WHERE room_id = ? GROUP BY item_id`
      )
      .bind(room.id)
      .all<{ item_id: string; yes_count: number; no_count: number }>();
    const tallyByItem = new Map(tallies.map((t) => [t.item_id, t]));

    const voterCount = await db
      .prepare("SELECT COUNT(DISTINCT voter_id) as count FROM votes WHERE room_id = ?")
      .bind(room.id)
      .first<{ count: number }>();

    // Items arrive in sort order and the sort is stable, so ties keep the
    // host's order.
    const results = items
      .map((item) => {
        const yesCount = tallyByItem.get(item.id)?.yes_count ?? 0;
        const noCount = tallyByItem.get(item.id)?.no_count ?? 0;
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

    return { totalVoters: voterCount?.count ?? 0, results };
  },
};
