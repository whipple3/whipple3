import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { EventMeta, LogRecord, Whipple3Event } from "@whipple3/core";
import type { LogStore } from "./port.js";

/**
 * NDJSON append-only file: the wire format and the storage format are the same. (SPEC §6)
 * subscribe() only observes in-process appends — sufficient for a single-engine session.
 * TODO(next): SQLite adapter, preferring built-in node:sqlite (SPEC §10).
 */
export const createJsonlLog = (path: string): LogStore => {
  const listeners = new Set<(r: LogRecord) => void>();
  let seq = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0;
  return {
    append(meta: EventMeta, event: Whipple3Event): Promise<LogRecord> {
      const record: LogRecord = { seq, meta, event };
      seq += 1;
      appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
      for (const l of listeners) l(record);
      return Promise.resolve(record);
    },
    read(fromSeq = 0): Promise<readonly LogRecord[]> {
      if (!existsSync(path)) return Promise.resolve([]);
      const records = readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogRecord);
      return Promise.resolve(records.slice(fromSeq));
    },
    subscribe(listener: (r: LogRecord) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
