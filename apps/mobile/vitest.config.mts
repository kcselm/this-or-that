import { defineConfig } from "vitest/config";

// Only pure modules under lib/ are unit-tested here; screens and components
// are exercised through the running app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
