import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "./types";
import { rooms } from "./routes/rooms";
import { votes } from "./routes/votes";
import { results } from "./routes/results";

const app = new Hono<App>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.route("/api/rooms", rooms);
app.route("/api/rooms", votes);
app.route("/api/rooms", results);

export default app;
