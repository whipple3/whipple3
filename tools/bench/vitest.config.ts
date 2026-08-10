import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The e2e spawns real serve + proxy processes; give slow CI headroom.
    testTimeout: 30_000,
  },
});
