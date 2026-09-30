import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
    // Types `exports` from "cloudflare:workers" as the Worker's own entrypoint.
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
  }
}

export {};
