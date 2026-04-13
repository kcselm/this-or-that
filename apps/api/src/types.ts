import { Hono } from "hono";

export type Bindings = {
  DB: D1Database;
};

export type App = {
  Bindings: Bindings;
};

export function createRouter() {
  return new Hono<App>();
}
