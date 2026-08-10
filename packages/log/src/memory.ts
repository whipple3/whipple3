import type { AraiEvent, EventMeta, LogRecord } from "@arai/core";
import type { LogStore } from "./port.js";

export const createMemoryLog = (): LogStore => {
  const records: LogRecord[] = [];
  const listeners = new Set<(r: LogRecord) => void>();
  return {
    append(meta: EventMeta, event: AraiEvent): Promise<LogRecord> {
      const record: LogRecord = { seq: records.length, meta, event };
      records.push(record);
      for (const l of listeners) l(record);
      return Promise.resolve(record);
    },
    read(fromSeq = 0): Promise<readonly LogRecord[]> {
      return Promise.resolve(records.slice(fromSeq));
    },
    subscribe(listener: (r: LogRecord) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
