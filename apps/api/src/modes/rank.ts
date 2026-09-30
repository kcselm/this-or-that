import { RANK_SLOTS } from "@tot/shared";
import { getItemsByRoomId, getRankingsByRoom, getRankingsByRoomAndVoter } from "../db/queries";
import { comparePlayers, listParticipants } from "../lib/participants";
import { nextRoomCodeFor } from "../lib/series";
import { shuffledItemIds, submissionProgress } from "./progress";
import type { ModeHandler } from "./types";

// Blind rank: items are revealed one at a time in a shared random order, and
// each player locks every item into a rank slot without seeing what's next.
export const rankMode: ModeHandler = {
  submitPath: "/rankings",

  // Items stay hidden from everyone but the host until they're dealt.
  showItems: (room, isCreator) => room.status === "open" && isCreator,

  async onStart(db, room) {
    const ids = await shuffledItemIds(db, room.id);
    await db.batch(
      ids.map((id, order) =>
        db.prepare("UPDATE items SET presentation_order = ? WHERE id = ?").bind(order, id)
      )
    );
  },

  async myState(db, room, voterId) {
    const rankings = await getRankingsByRoomAndVoter(db, room.id, voterId);
    return { myRankings: Object.fromEntries(rankings.map((r) => [r.item_id, r.rank])) };
  },

  progress: (db, room) => submissionProgress(db, room, "rankings"),

  // Keep-playing: who hosts the next round, and where that round lives.
  async statusExtra(db, room) {
    let nextHost: { participantId: string; name: string } | null = null;
    let nextRoomCode: string | null = null;
    if (room.status === "revealed") {
      if (room.next_host_voter_id) {
        const host = await db
          .prepare("SELECT id, voter_name FROM participants WHERE room_id = ? AND voter_id = ?")
          .bind(room.id, room.next_host_voter_id)
          .first<{ id: string; voter_name: string }>();
        if (host) nextHost = { participantId: host.id, name: host.voter_name };
      }
      nextRoomCode = await nextRoomCodeFor(db, room);
    }
    return { roundNumber: room.round_number, nextHost, nextRoomCode };
  },

  async results(db, room, voterId) {
    const items = await getItemsByRoomId(db, room.id);
    const titleById = new Map(items.map((i) => [i.id, i.title]));
    const rankings = await getRankingsByRoom(db, room.id);
    const participants = await listParticipants(db, room.id);

    const players = participants
      .map((p) => ({
        participantId: p.id,
        name: p.voter_name,
        isCreator: p.voter_id === room.creator_voter_id,
        isYou: !!voterId && p.voter_id === voterId,
        rankings: rankings
          .filter((r) => r.voter_id === p.voter_id)
          .map((r) => ({ rank: r.rank, itemId: r.item_id, title: titleById.get(r.item_id) ?? "" }))
          .sort((a, b) => a.rank - b.rank),
      }))
      // A force-reveal can leave boards half-filled; only complete ones show.
      .filter((p) => p.rankings.length === RANK_SLOTS)
      .sort(comparePlayers);

    return { players };
  },
};
