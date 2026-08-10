import type { LogRecord } from "@whipple3/core";
import type { ReadonlyLog } from "@whipple3/log";

export interface LogTail {
  records(): readonly LogRecord[];
  subscribe(listener: (record: LogRecord) => void): () => void;
  stop(): void;
}

/** Consecutive failed polls before a stall is reported — one torn line never trips it. */
export const STALL_AFTER = 4;

/**
 * Follows a session log by polling `ReadonlyLog.read(fromSeq)` — the jsonl adapter's
 * subscribe() only observes in-process appends, and the writer is another process.
 * Polling over the read port is the simple, robust tail; a push-capable log port is
 * a Wave 2 contract question. Read errors (e.g. a torn final line mid-append) are
 * transient: skip the batch, next poll rereads. A POISONED line mid-file is not —
 * every reread fails — so `onStall` fires once per failure episode instead of the
 * tail starving in silence; a successful poll re-arms it.
 */
export const startTail = (
  log: ReadonlyLog,
  pollMs = 250,
  onStall?: (error: unknown) => void,
): LogTail => {
  const seen: LogRecord[] = [];
  const listeners = new Set<(record: LogRecord) => void>();
  let reading = false;
  let failures = 0;
  let stalled = false;

  const poll = async (): Promise<void> => {
    if (reading) return;
    reading = true;
    try {
      const fresh = await log.read(seen.length);
      failures = 0;
      stalled = false;
      for (const record of fresh) {
        seen.push(record);
        for (const listener of listeners) listener(record);
      }
    } catch (error) {
      failures += 1;
      if (!stalled && failures >= STALL_AFTER) {
        stalled = true;
        onStall?.(error);
      }
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
