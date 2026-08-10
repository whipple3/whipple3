import { createJsonlLog } from "@whipple3/log";
import { sseHandler } from "./sse.js";
import { startTail } from "./tail.js";

/**
 * Server-side wiring, loaded by dev.mjs through Vite's SSR module runner
 * (workspace packages export TS source; plain Node cannot import them).
 * Studio only ever reads the log — the jsonl adapter is used as a ReadonlyLog.
 */
export const createEventsHandler = (logPath: string) =>
  sseHandler(
    startTail(createJsonlLog(logPath), 250, (error) => {
      // Server-side voice of the stall: lands in the terminal running `studio dev`.
      console.error(`whipple3 studio: log tail stalled on ${logPath} —`, error);
    }),
  );
