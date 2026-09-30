import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App, Bindings } from "./types";
import { rooms } from "./routes/rooms";
import { votes } from "./routes/votes";
import { results } from "./routes/results";
import { rankings } from "./routes/rankings";
import { bracket } from "./routes/bracket";
import { mlt, mltPrompts } from "./routes/mlt";
import { tiers } from "./routes/tiers";
import { purgeExpiredRooms } from "./lib/cleanup";
import { nowIso } from "./db/queries";

const app = new Hono<App>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON in request body" } },
      400
    );
  }
  console.error(err);
  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } },
    500
  );
});

app.route("/api/rooms", rooms);
app.route("/api/rooms", votes);
app.route("/api/rooms", results);
app.route("/api/rooms", rankings);
app.route("/api/rooms", bracket);
app.route("/api/rooms", mlt);
app.route("/api/rooms", tiers);
app.route("/api/mlt", mltPrompts);

export default {
  fetch: app.fetch,
  // Hourly cron (wrangler.toml): delete expired rooms so the tables stay small
  // and their codes can be reused.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      purgeExpiredRooms(env.DB, nowIso()).then((deleted) => {
        if (deleted > 0) console.log(`Purged ${deleted} expired room(s)`);
      })
    );
  },
} satisfies ExportedHandler<Bindings>;
