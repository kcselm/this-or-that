import { MODE_RULES, type Mode } from "@tot/shared";
import type { Room } from "../db/queries";
import { validationError } from "../lib/validation";
import { bracketMode } from "./bracket";
import { mltMode } from "./mlt";
import { rankMode } from "./rank";
import { tierMode } from "./tier";
import type { ModeHandler } from "./types";
import { voteMode } from "./vote";

export const MODE_HANDLERS: Record<Mode, ModeHandler> = {
  vote: voteMode,
  rank: rankMode,
  bracket: bracketMode,
  mlt: mltMode,
  tier: tierMode,
};

export function modeHandler(mode: Mode): ModeHandler {
  return MODE_HANDLERS[mode];
}

/** A 400 pointing at the right endpoint when a submission hits the wrong mode's route. */
export function wrongModeError(room: Room, expected: Mode): Response | null {
  if (room.mode === expected) return null;
  const { label } = MODE_RULES[room.mode];
  return validationError(
    `This is a ${label} room — use ${MODE_HANDLERS[room.mode].submitPath} instead`
  );
}

/**
 * Reveal the room if every participant has finished and there are enough of
 * them. Safe to call concurrently: only a voting room can flip. Bracket rooms
 * reveal when their final closes instead (see routes/bracket.ts).
 */
export async function maybeReveal(db: D1Database, room: Room): Promise<boolean> {
  const { voters } = await modeHandler(room.mode).progress(db, room);
  const enoughPlayers = voters.length >= MODE_RULES[room.mode].minPlayersToReveal;
  if (!enoughPlayers || voters.some((v) => !v.completed)) return false;

  await db
    .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
    .bind(room.id)
    .run();
  return true;
}
