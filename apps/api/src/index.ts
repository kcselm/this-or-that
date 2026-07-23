import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "./types";
import { rooms } from "./routes/rooms";
import { votes } from "./routes/votes";
import { results } from "./routes/results";
import { rankings } from "./routes/rankings";
import { bracket } from "./routes/bracket";
import { mlt, mltPrompts } from "./routes/mlt";
import { tiers } from "./routes/tiers";

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

export default app;
