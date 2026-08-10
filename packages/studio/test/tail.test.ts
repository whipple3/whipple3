import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogRecord } from "@whipple3/core";
import { createJsonlLog, type ReadonlyLog } from "@whipple3/log";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LogTail, startTail } from "../src/tail.js";
import { addNodeEvent, testMeta } from "./fixtures.js";

const dirs: string[] = [];
const tmpLogPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "whipple3-studio-tail-"));
  dirs.push(dir);
  return join(dir, "session.ndjson");
};

describe("startTail", () => {
  const open: LogTail[] = [];
  const tracked = (t: LogTail): LogTail => {
    open.push(t);
    return t;
  };
  afterEach(() => {
    for (const t of open.splice(0)) t.stop();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("replays records already in the log when it starts", async () => {
    const path = tmpLogPath();
    const writer = createJsonlLog(path);
    await writer.append(testMeta(0), addNodeEvent(0));
    await writer.append(testMeta(1), addNodeEvent(1));

    const tail = tracked(startTail(createJsonlLog(path), 5));

    await vi.waitFor(() => expect(tail.records()).toHaveLength(2));
    expect(tail.records().map((r) => r.seq)).toEqual([0, 1]);
  });

  it("notifies subscribers of records appended after start", async () => {
    const path = tmpLogPath();
    const writer = createJsonlLog(path);
    const tail = tracked(startTail(createJsonlLog(path), 5));
    const seen: LogRecord[] = [];
    tail.subscribe((r) => seen.push(r));

    await writer.append(testMeta(0), addNodeEvent(0));

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.event.type).toBe("graph.mutation");
    expect(seen[0]?.seq).toBe(0);
  });

  it("tails a file that does not exist yet", async () => {
    const path = tmpLogPath();
    const tail = tracked(startTail(createJsonlLog(path), 5));
    await new Promise((r) => setTimeout(r, 15));
    expect(tail.records()).toHaveLength(0);

    const lateWriter = createJsonlLog(path);
    await lateWriter.append(testMeta(0), addNodeEvent(0));

    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));
  });

  it("stops notifying after unsubscribe", async () => {
    const path = tmpLogPath();
    const writer = createJsonlLog(path);
    const tail = tracked(startTail(createJsonlLog(path), 5));
    const seen: LogRecord[] = [];
    const unsubscribe = tail.subscribe((r) => seen.push(r));
    unsubscribe();

    await writer.append(testMeta(0), addNodeEvent(0));

    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));
    expect(seen).toHaveLength(0);
  });

  it("stops polling after stop()", async () => {
    const path = tmpLogPath();
    const writer = createJsonlLog(path);
    await writer.append(testMeta(0), addNodeEvent(0));
    const tail = tracked(startTail(createJsonlLog(path), 5));
    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));

    tail.stop();
    await writer.append(testMeta(1), addNodeEvent(1));
    await new Promise((r) => setTimeout(r, 30));

    expect(tail.records()).toHaveLength(1);
  });

  it("keeps polling after a failed read", async () => {
    let calls = 0;
    const flaky: ReadonlyLog = {
      read: (fromSeq = 0) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("torn line"));
        return Promise.resolve(
          [{ seq: 0, meta: testMeta(0), event: addNodeEvent(0) }].slice(fromSeq),
        );
      },
      subscribe: () => () => {},
    };

    const tail = tracked(startTail(flaky, 5));

    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));
    expect(calls).toBeGreaterThan(1);
  });

  it("reports a stall once per episode when every read fails, and re-arms on recovery", async () => {
    // A torn FINAL line heals on the next poll; a poisoned line MID-file fails every
    // read forever — without a stall signal the tail starves in silence.
    let failing = true;
    let calls = 0;
    const poisoned: ReadonlyLog = {
      read: (fromSeq = 0) => {
        calls += 1;
        if (failing) return Promise.reject(new Error("poisoned line"));
        return Promise.resolve(
          [{ seq: 0, meta: testMeta(0), event: addNodeEvent(0) }].slice(fromSeq),
        );
      },
      subscribe: () => () => {},
    };
    const stalls: unknown[] = [];
    const tail = tracked(startTail(poisoned, 5, (error) => stalls.push(error)));

    await vi.waitFor(() => expect(stalls).toHaveLength(1)); // fires after a few failures…
    const callsAtStall = calls;
    await vi.waitFor(() => expect(calls).toBeGreaterThan(callsAtStall + 3));
    expect(stalls).toHaveLength(1); // …but only once while the episode lasts

    failing = false;
    // A RECORD arriving is the proof a successful poll ran and re-armed the fuse —
    // waiting on call counts races the episode above.
    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));
    failing = true;
    await vi.waitFor(() => expect(stalls).toHaveLength(2)); // a new episode fires again
  });
});
