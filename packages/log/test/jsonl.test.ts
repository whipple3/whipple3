import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventMeta, LogRecord, Whipple3Event } from "@whipple3/core";
import { agentId, principal, sessionId, txId } from "@whipple3/core";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonlLog } from "../src/jsonl.js";

const meta = (n: number): EventMeta => ({
  txId: txId(`tx${n}`),
  sessionId: sessionId("s1"),
  agentId: agentId("a1"),
  principal: principal("p1"),
  ts: n,
  causationId: null,
  correlationId: txId("tx0"),
});

const ev: Whipple3Event = { type: "session.started", task: "jsonl" };

describe("jsonl adapter — incremental read over byte offsets", () => {
  const dirs: string[] = [];
  const tmpFile = () => {
    const dir = mkdtempSync(join(tmpdir(), "whipple3-jsonl-"));
    dirs.push(dir);
    return join(dir, "session.ndjson");
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("read picks up records another process appended to the file", async () => {
    // Cross-process tailing (studio's polling pattern): the reader holds the adapter,
    // a foreign writer appends raw NDJSON lines behind its back.
    const path = tmpFile();
    const store = createJsonlLog(path);
    await store.append(meta(1), ev);
    expect(await store.read()).toHaveLength(1);

    const foreign: LogRecord = { seq: 1, meta: meta(2), event: ev };
    appendFileSync(path, `${JSON.stringify(foreign)}\n`, "utf8");
    const tail = await store.read(1);
    expect(tail).toHaveLength(1);
    expect(tail[0]?.meta.ts).toBe(2);
  });

  it("read(fromSeq) does not re-read bytes before the requested offset", async () => {
    // The incrementality proof: after the file is indexed, clobber the FIRST line
    // in place (same byte length, no newlines). A whole-file re-reader chokes on the
    // garbage; an offset-seeking reader never touches those bytes again.
    const path = tmpFile();
    const store = createJsonlLog(path);
    const first = await store.append(meta(1), ev);
    await store.append(meta(2), ev);
    await store.append(meta(3), ev);
    await store.read(); // index the whole file

    const firstLineBytes = Buffer.byteLength(`${JSON.stringify(first)}`, "utf8");
    const fd = openSync(path, "r+");
    writeSync(fd, "x".repeat(firstLineBytes), 0, "utf8");
    closeSync(fd);

    const tail = await store.read(1);
    expect(tail.map((r) => r.meta.ts)).toEqual([2, 3]);
  });

  it("a new adapter over an existing file continues seq from the existing records", async () => {
    const path = tmpFile();
    const first = createJsonlLog(path);
    await first.append(meta(1), ev);
    await first.append(meta(2), ev);

    const second = createJsonlLog(path);
    const appended = await second.append(meta(3), ev);
    expect(appended.seq).toBe(2);
    const all = await second.read();
    expect(all.map((r) => r.seq)).toEqual([0, 1, 2]);
  });
});
