import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonlLog } from "../src/jsonl.js";
import { createMemoryLog } from "../src/memory.js";
import { runLogStoreConformance } from "./logstore.suite.js";

runLogStoreConformance("memory", () =>
  Promise.resolve({ store: createMemoryLog(), cleanup: () => Promise.resolve() }),
);

runLogStoreConformance("jsonl", () => {
  const dir = mkdtempSync(join(tmpdir(), "whipple3-log-"));
  const store = createJsonlLog(join(dir, "session.ndjson"));
  return Promise.resolve({
    store,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      return Promise.resolve();
    },
  });
});
