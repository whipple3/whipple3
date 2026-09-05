import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  clean: true,
  // Workspace deps resolve to src/*.ts in dev (internal-package pattern), which plain
  // `node dist/main.js` cannot load — so the bin inlines them; npm deps stay external.
  noExternal: [/^@whipple3\//],
  // The studio page is a Vite browser bundle, so tsup cannot inline it the way it
  // inlines the TS packages. It ships beside the bin; `whipple3 studio` serves it
  // from there. pnpm builds studio first — the cli depends on it.
  onSuccess: async () => {
    await cp(
      fileURLToPath(new URL("../studio/dist", import.meta.url)),
      fileURLToPath(new URL("./dist/studio", import.meta.url)),
      { recursive: true },
    );
  },
});
