import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentId,
  type EventMeta,
  type LogRecord,
  nodeId,
  sessionId,
  txId,
  type Whipple3Event,
} from "@whipple3/core";
import { createJsonlLog, type ReadonlyLog } from "@whipple3/log";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LogTail, startTail } from "../src/tail.js";

const meta = (n: number): EventMeta => ({
  txId: txId(`tx-${n}`),
  sessionId: sessionId("s1"),
  agentId: agentId("writer"),
  principal: null,
  ts: n,
  causationId: null,
  correlationId: txId("corr"),
});

const addNode = (n: number): Whipple3Event => ({
  type: "graph.mutation",
  mutation: { kind: "ADD_NODE", id: nodeId(`n${n}`), label: "file", props: {} },
});

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
    await writer.append(meta(0), addNode(0));
    await writer.append(meta(1), addNode(1));

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

    await writer.append(meta(0), addNode(0));

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
    await lateWriter.append(meta(0), addNode(0));

    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));
  });

  it("stops notifying after unsubscribe", async () => {
    const path = tmpLogPath();
    const writer = createJsonlLog(path);
    const tail = tracked(startTail(createJsonlLog(path), 5));
    const seen: LogRecord[] = [];
    const unsubscribe = tail.subscribe((r) => seen.push(r));
    unsubscribe();

    await writer.append(meta(0), addNode(0));

    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));
    expect(seen).toHaveLength(0);
  });

  it("stops polling after stop()", async () => {
    const path = tmpLogPath();
    const writer = createJsonlLog(path);
    await writer.append(meta(0), addNode(0));
    const tail = tracked(startTail(createJsonlLog(path), 5));
    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));

    tail.stop();
    await writer.append(meta(1), addNode(1));
    await new Promise((r) => setTimeout(r, 30));

    expect(tail.records()).toHaveLength(1);
  });

  it("keeps polling after a failed read", async () => {
    let calls = 0;
    const flaky: ReadonlyLog = {
      read: (fromSeq = 0) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("torn line"));
        return Promise.resolve([{ seq: 0, meta: meta(0), event: addNode(0) }].slice(fromSeq));
      },
      subscribe: () => () => {},
    };

    const tail = tracked(startTail(flaky, 5));

    await vi.waitFor(() => expect(tail.records()).toHaveLength(1));
    expect(calls).toBeGreaterThan(1);
  });
});
