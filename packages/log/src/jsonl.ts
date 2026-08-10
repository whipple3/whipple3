import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { EventMeta, LogRecord, Whipple3Event } from "@whipple3/core";
import type { LogStore } from "./port.js";

const NEWLINE = 0x0a;

/**
 * NDJSON append-only file: the wire format and the storage format are the same. (SPEC §6)
 * read(fromSeq) is incremental: a byte-offset index maps each seq to its line start, so a
 * read costs the requested tail (plus indexing whatever foreign writers appended since the
 * last call) — never the whole file. Offsets are BYTES, and line scanning happens on the
 * raw buffer: 0x0A cannot occur inside a UTF-8 multibyte sequence, while character indexes
 * would drift on non-ASCII payloads. subscribe() only observes in-process appends —
 * cross-process tailing polls read(). (W1-C request (c))
 * TODO(next): SQLite adapter, preferring built-in node:sqlite (SPEC §10).
 */
export const createJsonlLog = (path: string): LogStore => {
  const listeners = new Set<(r: LogRecord) => void>();
  const offsets: number[] = []; // byte offset where record `seq` starts
  let indexed = 0; // bytes covered by complete, indexed lines

  const readChunk = (from: number, to: number): Buffer => {
    const fd = openSync(path, "r");
    try {
      const chunk = Buffer.alloc(to - from);
      readSync(fd, chunk, 0, chunk.length, from);
      return chunk;
    } finally {
      closeSync(fd);
    }
  };

  /** Extend the index over bytes appended since the last scan (possibly by another process). */
  const scan = (): void => {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size <= indexed) return;
    const chunk = readChunk(indexed, size);
    let consumed = 0;
    for (let nl = chunk.indexOf(NEWLINE); nl >= 0; nl = chunk.indexOf(NEWLINE, consumed)) {
      offsets.push(indexed + consumed);
      consumed = nl + 1;
    }
    indexed += consumed; // a trailing partial line stays unindexed until its newline lands
  };

  return {
    append(meta: EventMeta, event: Whipple3Event): Promise<LogRecord> {
      scan(); // seq must account for anything a foreign writer appended meanwhile
      const record: LogRecord = { seq: offsets.length, meta, event };
      const line = `${JSON.stringify(record)}\n`;
      appendFileSync(path, line, "utf8");
      offsets.push(indexed);
      indexed += Buffer.byteLength(line, "utf8");
      for (const l of listeners) l(record);
      return Promise.resolve(record);
    },
    read(fromSeq = 0): Promise<readonly LogRecord[]> {
      if (!existsSync(path)) return Promise.resolve([]);
      scan();
      const start = offsets[fromSeq];
      if (start === undefined) return Promise.resolve([]);
      const records = readChunk(start, indexed)
        .toString("utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as LogRecord);
      return Promise.resolve(records);
    },
    subscribe(listener: (r: LogRecord) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
