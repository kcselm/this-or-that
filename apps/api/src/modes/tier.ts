import { TIERS, TIER_VALUE, tierForAverage, type Tier } from "@tot/shared";
import { getItemsByRoomId, getTierPlacementsByRoom, getTierPlacementsByVoter } from "../db/queries";
import { comparePlayers, listParticipants } from "../lib/participants";
import { submissionProgress } from "./progress";
import type { ModeHandler } from "./types";

// Tier list: each player sorts every item into S-D and locks their board in
// one go. The reveal shows a consensus board plus everyone's own board.
export const tierMode: ModeHandler = {
  submitPath: "/tiers",

  showItems: (room, isCreator) => room.status !== "open" || isCreator,

  async myState(db, room, voterId) {
    const placements = await getTierPlacementsByVoter(db, room.id, voterId);
    return { myTiers: Object.fromEntries(placements.map((p) => [p.item_id, p.tier])) };
  },

  progress: (db, room) => submissionProgress(db, room, "tier_placements"),

  async results(db, room, voterId) {
    const items = await getItemsByRoomId(db, room.id); // sort_order ASC
    const titleById = new Map(items.map((i) => [i.id, i.title]));
    const orderById = new Map(items.map((i) => [i.id, i.sort_order]));
    const byHostOrder = (a: { itemId: string }, b: { itemId: string }) =>
      (orderById.get(a.itemId) ?? 0) - (orderById.get(b.itemId) ?? 0);
    const placements = await getTierPlacementsByRoom(db, room.id);
    const participants = await listParticipants(db, room.id);

    // Consensus: average each item's tier value over every placement, then
    // round back to a tier. Within a tier, higher averages come first.
    const totals = new Map<string, { sum: number; count: number }>();
    for (const p of placements) {
      const t = totals.get(p.item_id) ?? { sum: 0, count: 0 };
      t.sum += TIER_VALUE[p.tier];
      t.count += 1;
      totals.set(p.item_id, t);
    }
    const averaged = items.flatMap((item) => {
      const t = totals.get(item.id);
      if (!t) return []; // unplaced by everyone, possible only after a force-reveal
      const average = t.sum / t.count;
      return [{ itemId: item.id, title: item.title, average, tier: tierForAverage(average) }];
    });
    const consensus = TIERS.map((tier) => ({
      tier,
      items: averaged
        .filter((a) => a.tier === tier)
        .sort((a, b) => b.average - a.average || byHostOrder(a, b))
        .map(({ itemId, title, average }) => ({ itemId, title, average })),
    }));

    const players = participants
      .map((p) => ({
        participantId: p.id,
        name: p.voter_name,
        isCreator: p.voter_id === room.creator_voter_id,
        isYou: !!voterId && p.voter_id === voterId,
        placements: placements
          .filter((pl) => pl.voter_id === p.voter_id)
          .map((pl) => ({ itemId: pl.item_id, title: titleById.get(pl.item_id) ?? "", tier: pl.tier as Tier }))
          .sort(byHostOrder),
      }))
      // Boards are submitted whole, so anyone with placements has a full board.
      .filter((p) => p.placements.length === items.length)
      .sort(comparePlayers);

    return { consensus, players };
  },
};
