import { DRAFT_ROUNDS, roundForPick, seatForPick, totalPicks, type DraftOrder } from "@tot/shared";
import { getDraftPicks, getDraftSeats, type Room } from "../db/queries";
import { listParticipants } from "../lib/participants";
import type { ModeHandler } from "./types";

// Draft: players take turns claiming free-text picks for the topic, in a seat
// order drawn when the room starts. The room stores no items; every pick is a
// row in draft_picks, whose UNIQUE constraints enforce the turn order and the
// no-duplicates rule (see routes/draft.ts).
export const draftMode: ModeHandler = {
  submitPath: "/picks",

  showItems: () => false,

  roomSettings: (room) => draftSettings(room),

  // Draw the turn order at random so creating the room gives the host no edge.
  async onStart(db, room) {
    const voterIds = (await listParticipants(db, room.id)).map((p) => p.voter_id);
    for (let i = voterIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [voterIds[i], voterIds[j]] = [voterIds[j], voterIds[i]];
    }
    const insert = db.prepare("INSERT INTO draft_seats (room_id, voter_id, seat) VALUES (?, ?, ?)");
    await db.batch(voterIds.map((voterId, seat) => insert.bind(room.id, voterId, seat)));
  },

  async progress(db, room) {
    const board = await loadDraft(db, room);
    const { draftRounds } = draftSettings(room);
    const picksByVoter = new Map<string, number>();
    for (const p of board.picks) {
      picksByVoter.set(p.voterId, (picksByVoter.get(p.voterId) ?? 0) + 1);
    }
    return {
      voters: board.participants.map((p) => ({
        voterId: p.voter_id,
        name: p.voter_name,
        completed: (picksByVoter.get(p.voter_id) ?? 0) >= draftRounds,
      })),
      extra: { picksMade: board.picks.length, totalPicks: board.totalPicks },
    };
  },

  async statusExtra(db, room) {
    const { current } = await loadDraft(db, room);
    return {
      currentPick: current ? { participantId: current.participantId, name: current.name } : null,
    };
  },

  async results(db, room, voterId) {
    const board = await loadDraft(db, room);
    const { draftOrder, draftRounds } = draftSettings(room);
    return {
      draftOrder,
      rounds: draftRounds,
      totalPicks: board.totalPicks,
      picksMade: board.picks.length,
      // Seat order, each list in pick order. A force-reveal can leave lists short.
      players: board.seats.map((s) => ({
        seat: s.seat,
        participantId: s.participantId,
        name: s.name,
        isCreator: s.voterId === room.creator_voter_id,
        isYou: !!voterId && s.voterId === voterId,
        picks: board.picks
          .filter((p) => p.seat === s.seat)
          .map((p) => ({ pickIndex: p.pickIndex, round: p.round, title: p.title })),
      })),
    };
  },
};

/** The room's draft settings; NULL columns (never expected) fall back to the defaults. */
export function draftSettings(room: Room): { draftOrder: DraftOrder; draftRounds: number } {
  return {
    draftOrder: room.draft_order ?? "snake",
    draftRounds: room.draft_rounds ?? DRAFT_ROUNDS.default,
  };
}

export type BoardSeat = {
  seat: number;
  /** Internal only: never include in a response. */
  voterId: string;
  participantId: string;
  name: string;
};

export type BoardPick = {
  pickIndex: number;
  round: number;
  seat: number;
  /** Internal only: never include in a response. */
  voterId: string;
  participantId: string;
  name: string;
  title: string;
};

/**
 * The whole draft as the server sees it, keyed internally by voter id. Callers
 * map it to public participant ids before anything leaves the server.
 */
export async function loadDraft(db: D1Database, room: Room) {
  const [seatRows, pickRows, participants] = await Promise.all([
    getDraftSeats(db, room.id),
    getDraftPicks(db, room.id),
    listParticipants(db, room.id),
  ]);
  const { draftOrder, draftRounds } = draftSettings(room);
  const byVoter = new Map(participants.map((p) => [p.voter_id, p]));

  // Names come from the participant row, so a rename shows up everywhere.
  const seats: BoardSeat[] = seatRows.map((s) => ({
    seat: s.seat,
    voterId: s.voter_id,
    participantId: byVoter.get(s.voter_id)?.id ?? "",
    name: byVoter.get(s.voter_id)?.voter_name ?? "",
  }));
  const seatByVoter = new Map(seats.map((s) => [s.voterId, s]));

  const picks: BoardPick[] = pickRows.map((p) => {
    const seat = seatByVoter.get(p.voter_id);
    return {
      pickIndex: p.pick_index,
      round: roundForPick(Math.max(seats.length, 1), p.pick_index),
      seat: seat?.seat ?? -1,
      voterId: p.voter_id,
      participantId: seat?.participantId ?? "",
      name: seat?.name ?? p.voter_name,
      title: p.title,
    };
  });

  // Before the start draws seats, the draft would seat everyone who has joined.
  const total = totalPicks(seats.length || participants.length, draftRounds);
  const complete = seats.length > 0 && picks.length >= total;

  let current: (BoardSeat & { pickIndex: number; round: number }) | null = null;
  if (room.status === "voting" && seats.length > 0 && !complete) {
    const pickIndex = picks.length;
    const seat = seats[seatForPick(draftOrder, seats.length, pickIndex)];
    current = { ...seat, pickIndex, round: roundForPick(seats.length, pickIndex) };
  }

  return { participants, seats, picks, totalPicks: total, complete, current };
}
