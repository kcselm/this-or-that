import { getLatestSeriesRoom, type Room } from "../db/queries";

/**
 * Code of the newest round in this room's series, if a later round exists.
 * Latecomers holding an old code are forwarded there.
 */
export async function nextRoomCodeFor(db: D1Database, room: Room): Promise<string | null> {
  if (!room.next_room_id) return null;
  const latest = await getLatestSeriesRoom(db, room.series_id ?? room.id);
  return latest && latest.round_number > room.round_number ? latest.code : null;
}
