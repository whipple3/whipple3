/**
 * Server-side entry. `src/main.ts` is the browser bundle (DOM + sigma) and is
 * deliberately NOT re-exported here — the CLI inlines this module through tsup,
 * and pulling the browser graph in would drag sigma into the bin.
 */
export { createEventsHandler } from "./attach.js";
export { runFixture } from "./fixture.js";
