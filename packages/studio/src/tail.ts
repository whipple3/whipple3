import type { LogRecord } from "@whipple3/core";
import type { ReadonlyLog } from "@whipple3/log";

export interface LogTail {
  records(): readonly LogRecord[];
  subscribe(listener: (record: LogRecord) => void): () => void;
  stop(): void;
}

/**
 * Follows a session log by polling `ReadonlyLog.read(fromSeq)` — the jsonl adapter's
 * subscribe() only observes in-process appends, and the writer is another process.
 * Polling over the read port is the simple, robust tail; a push-capable log port is
 * a Wave 2 contract question. Read errors (e.g. a torn final line mid-append) are
 * transient: skip the batch, next poll rereads.
 */
export const startTail = (log: ReadonlyLog, pollMs = 250): LogTail => {
  const seen: LogRecord[] = [];
  const listeners = new Set<(record: LogRecord) => void>();
  let reading = false;

  const poll = async (): Promise<void> => {
    if (reading) return;
    reading = true;
    try {
      const fresh = await log.read(seen.length);
      for (const record of fresh) {
        seen.push(record);
        for (const listener of listeners) listener(record);
      }
    } catch {
      // transient read failure — retry on the next tick
    } finally {
      reading = false;
    }
  };

  void poll();
  const timer = setInterval(() => void poll(), pollMs);

  return {
    records: () => seen,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => clearInterval(timer),
  };
};
