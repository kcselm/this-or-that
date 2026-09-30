import { MODE_RULES, pickKey, roundForPick, seatForPick } from "@tot/shared";
import { createRouter } from "../types";
import { getDraftPickCount, getDraftSeats, getRoomByCode, type Room } from "../db/queries";
import {
  errorResponse,
  invalidStatus,
  isUniqueViolation,
  notFound,
  validationError,
} from "../lib/validation";
import { isParticipant, isValidName, listParticipants } from "../lib/participants";
import { maybeReveal, wrongModeError } from "../modes";
import { draftSettings, loadDraft } from "../modes/draft";

export const draft = createRouter();

// GET /api/rooms/:code/draft?voterId=X — the board, polled by the play screen.
// Picks are public (everyone sees what's been taken); voter ids never leave.
draft.get("/:code/draft", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.mode !== "draft") return invalidStatus("This room is not a draft room");
  if (room.status === "open") return invalidStatus("The draft hasn't started yet");

  const board = await loadDraft(db, room);
  const { draftOrder, draftRounds } = draftSettings(room);
  const isYou = (v: string) => !!voterId && v === voterId;

  return Response.json({
    status: room.status,
    draftOrder,
    rounds: draftRounds,
    totalPicks: board.totalPicks,
    seats: board.seats.map((s) => ({
      seat: s.seat,
      participantId: s.participantId,
      name: s.name,
      isCreator: s.voterId === room.creator_voter_id,
      isYou: isYou(s.voterId),
    })),
    picks: board.picks.map((p) => ({
      pickIndex: p.pickIndex,
      round: p.round,
      seat: p.seat,
      participantId: p.participantId,
      name: p.name,
      title: p.title,
    })),
    current: board.current
      ? {
          pickIndex: board.current.pickIndex,
          round: board.current.round,
          seat: board.current.seat,
          participantId: board.current.participantId,
          name: board.current.name,
          isYou: isYou(board.current.voterId),
        }
      : null,
    complete: board.complete,
  });
});

// POST /api/rooms/:code/picks — draft an entry on your turn.
draft.post("/:code/picks", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { voterId, voterName, title } = body;
  const { maxItemLength } = MODE_RULES.draft;

  if (!voterId || typeof voterId !== "string") {
    return validationError("voterId is required");
  }
  if (!isValidName(voterName)) {
    return validationError("voterName is required and must be 1-30 characters");
  }
  if (typeof title !== "string" || title.trim().length < 1 || title.trim().length > maxItemLength) {
    return validationError(`title is required and must be 1-${maxItemLength} characters`);
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  const wrongMode = wrongModeError(room, "draft");
  if (wrongMode) return wrongMode;
  if (room.status !== "voting") {
    return invalidStatus("Picks can only be made while the draft is running");
  }

  if (!(await isParticipant(db, room.id, voterId))) {
    return validationError("You must join the room before drafting");
  }

  const seats = await getDraftSeats(db, room.id);
  const mySeat = seats.find((s) => s.voter_id === voterId);
  if (!mySeat) {
    // Only reachable in the instant between the start and the seat draw.
    return invalidStatus("You don't have a seat in this draft");
  }
  const { draftOrder, draftRounds } = draftSettings(room);
  const total = seats.length * draftRounds;

  // The count is only a guess at the next pick index: the UNIQUE on
  // (room_id, pick_index) is what decides who actually gets it.
  const pickIndex = await getDraftPickCount(db, room.id);
  if (pickIndex >= total) return invalidStatus("The draft is complete");
  const onTheClock = seatForPick(draftOrder, seats.length, pickIndex);
  if (onTheClock !== mySeat.seat) {
    return notYourTurn(db, room, seats[onTheClock].voter_id);
  }

  const trimmed = title.trim();
  const key = pickKey(trimmed);
  try {
    await db
      .prepare(
        "INSERT INTO draft_picks (id, room_id, pick_index, voter_id, voter_name, title, title_key) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), room.id, pickIndex, voterId, voterName.trim(), trimmed, key)
      .run();
  } catch (e: unknown) {
    if (!isUniqueViolation(e)) throw e;
    // Which constraint fired? A taken title is the player's problem to fix;
    // otherwise another pick claimed this index first and the turn moved on.
    const taken = await db
      .prepare("SELECT title FROM draft_picks WHERE room_id = ? AND title_key = ?")
      .bind(room.id, key)
      .first<{ title: string }>();
    if (taken) {
      return errorResponse("DUPLICATE_PICK", `${taken.title} has already been drafted`, 409);
    }
    const now = await getDraftPickCount(db, room.id);
    if (now >= total) return invalidStatus("The draft is complete");
    return notYourTurn(db, room, seats[seatForPick(draftOrder, seats.length, now)].voter_id);
  }

  const complete = pickIndex + 1 >= total;
  const isRevealed = complete ? await maybeReveal(db, room) : false;

  return Response.json(
    {
      success: true,
      pick: {
        pickIndex,
        round: roundForPick(seats.length, pickIndex),
        seat: mySeat.seat,
        title: trimmed,
      },
      complete,
      isRevealed,
    },
    { status: 201 }
  );
});

async function notYourTurn(db: D1Database, room: Room, voterOnTheClock: string) {
  const participants = await listParticipants(db, room.id);
  const name = participants.find((p) => p.voter_id === voterOnTheClock)?.voter_name ?? "someone";
  return errorResponse("NOT_YOUR_TURN", `It's ${name}'s turn`, 400);
}
