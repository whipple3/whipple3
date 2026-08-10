import type { AraiEvent, EventMeta, LogRecord } from "@arai/core";

/** Narrow ports (SPEC §9.1-I): Studio depends on ReadonlyLog, never on append. */
export interface ReadonlyLog {
  read(fromSeq?: number): Promise<readonly LogRecord[]>;
  subscribe(listener: (record: LogRecord) => void): () => void;
}

export interface LogStore extends ReadonlyLog {
  append(meta: EventMeta, event: AraiEvent): Promise<LogRecord>;
}
