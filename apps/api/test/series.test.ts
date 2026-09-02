import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { createRoom } from "./helpers";

describe("room series schema", () => {
  it("a new room is round 1 of no series", async () => {
    const { roomId } = await createRoom("rank");
    const row = await env.DB.prepare(
      "SELECT series_id, round_number, next_host_voter_id, next_room_id FROM rooms WHERE id = ?"
    )
      .bind(roomId)
      .first<any>();
    expect(row).toEqual({
      series_id: null,
      round_number: 1,
      next_host_voter_id: null,
      next_room_id: null,
    });
  });
});
