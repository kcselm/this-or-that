import type { Room } from "../db/queries";

export type Json = Record<string, unknown>;

export type VoterProgress = {
  voterId: string;
  name: string;
  completed: boolean;
};

export type Progress = {
  /** Every participant, in join order. */
  voters: VoterProgress[];
  /** Mode-specific fields added to /status and to /results before the reveal. */
  extra?: Json;
};

// Everything that differs between game modes lives behind this interface, so
// the shared routes (rooms, status, results) never branch on room.mode. A new
// mode is a new handler plus its rules in @tot/shared.
export type ModeHandler = {
  /** Endpoint that takes this mode's submissions, named in wrong-endpoint errors. */
  submitPath: string;
  /** Whether GET /rooms/:code includes the item list for this viewer. */
  showItems(room: Room, isCreator: boolean): boolean;
  /** Set the room up for play, right after it flips from open to voting. */
  onStart?(db: D1Database, room: Room): Promise<void>;
  /** The viewer's own submissions, added to GET /rooms/:code so they can resume. */
  myState?(db: D1Database, room: Room, voterId: string): Promise<Json>;
  /** Who has finished. Drives /status, pending /results, and the auto-reveal. */
  progress(db: D1Database, room: Room): Promise<Progress>;
  /** Extra /status fields that play no part in deciding the reveal. */
  statusExtra?(db: D1Database, room: Room): Promise<Json>;
  /** The revealed results, minus the common revealed/mode/topic fields. */
  results(db: D1Database, room: Room, voterId: string | undefined): Promise<Json>;
};
