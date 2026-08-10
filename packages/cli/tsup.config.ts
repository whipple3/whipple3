import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  clean: true,
  // Workspace deps resolve to src/*.ts in dev (internal-package pattern), which plain
  // `node dist/main.js` cannot load — so the bin inlines them; npm deps stay external.
  noExternal: [/^@arai\//],
});
