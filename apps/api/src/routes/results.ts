import { createRouter } from "../types";
import { getRoomByCode } from "../db/queries";
import { notFound, notCreator, invalidStatus, validationError } from "../lib/validation";
import { modeHandler } from "../modes";
import { completedCount } from "../modes/progress";

export const results = createRouter();

// GET /api/rooms/:code/status — Check voting progress
results.get("/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const handler = modeHandler(room.mode);
  const progress = await handler.progress(db, room);

  return Response.json({
    totalVoters: progress.voters.length,
    completedCount: completedCount(progress),
    isRevealed: room.status === "revealed",
    voters: progress.voters.map((v) => ({ name: v.name, completed: v.completed })),
    ...progress.extra,
    ...(await handler.statusExtra?.(db, room)),
  });
});

// GET /api/rooms/:code/results — Final results, or progress until revealed
results.get("/:code/results", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const voterId = c.req.query("voterId");

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();

  const handler = modeHandler(room.mode);

  if (room.status !== "revealed") {
    const progress = await handler.progress(db, room);
    return Response.json({
      revealed: false,
      mode: room.mode,
      completedCount: completedCount(progress),
      totalVoters: progress.voters.length,
      ...progress.extra,
    });
  }

  return Response.json({
    revealed: true,
    mode: room.mode,
    topic: room.topic,
    ...(await handler.results(db, room, voterId)),
  });
});

// POST /api/rooms/:code/reveal — Creator force-reveals results
results.post("/:code/reveal", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json();
  const { creatorVoterId } = body;

  if (!creatorVoterId || typeof creatorVoterId !== "string") {
    return validationError("Creator voter ID is required");
  }

  const db = c.env.DB;
  const room = await getRoomByCode(db, code);
  if (!room) return notFound();
  if (room.creator_voter_id !== creatorVoterId) return notCreator();
  if (room.status !== "voting") return invalidStatus("Room must be in voting status to reveal");

  await db
    .prepare("UPDATE rooms SET status = 'revealed' WHERE id = ? AND status = 'voting'")
    .bind(room.id)
    .run();

  return Response.json({ success: true, status: "revealed" });
});
