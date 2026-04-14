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

export default app;
