import { mkdtempSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentId, principal, sessionId, txId } from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { createSession } from "@whipple3/transport-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectBoard } from "../src/client.js";
import { createLineBuffer, encodeFrame } from "../src/frames.js";
import { startBoardServer } from "../src/server.js";

/**
 * A socket stream has no message boundaries: a multi-byte UTF-8 character may be split
 * across two 'data' events. Decoding each chunk independently turns the halves into
 * U+FFFD — and since JSON's structural characters are all ASCII, the frame still parses
 * and the corruption lands silently inside Hebrew prop values. These tests force the
 * split at exactly such a byte.
 */
const HEBREW = "שלום עולם — לוח משותף";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** First UTF-8 continuation byte — cutting here splits a character between chunks. */
const splitInsideChar = (buf: Buffer): number => {
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte !== undefined && (byte & 0xc0) === 0x80) return i;
  }
  throw new Error("frame contains no multi-byte character");
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const makeBoard = async () => {
  const dir = mkdtempSync(join(tmpdir(), "w3utf8-"));
  let n = 0;
  const session = createSession({
    log: createMemoryLog(),
    acl: null,
    sessionId: sessionId("s1"),
    principal: principal("michael"),
    now: () => 0,
    newTxId: () => txId(`tx${n++}`),
  });
  const socketPath = join(dir, "b.sock");
  const server = await startBoardServer({ session, socketPath });
  cleanups.push(() => server.close());
  return { socketPath };
};

describe("UDS framing — multi-byte characters survive arbitrary chunk splits", () => {
  it("server inbound: a post frame cut mid-character stores the exact Hebrew text", async () => {
    const { socketPath } = await makeBoard();

    const socket = connect(socketPath);
    cleanups.push(() => {
      socket.destroy();
    });
    const frames: unknown[] = [];
    const push = createLineBuffer();
    socket.on("data", (chunk) => {
      for (const line of push(chunk.toString("utf8"))) frames.push(JSON.parse(line));
    });
    await new Promise<void>((r) => socket.once("connect", () => r()));
    socket.write(encodeFrame({ kind: "hello", v: 1, agentId: "poster" }));
    await vi.waitFor(() => expect(frames).toContainEqual({ kind: "ready" }));

    const frame = Buffer.from(
      encodeFrame({
        kind: "req",
        id: 0,
        op: "post",
        input: {
          mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { text: HEBREW } },
        },
      }),
      "utf8",
    );
    const cut = splitInsideChar(frame);
    socket.write(frame.subarray(0, cut));
    await wait(30); // let the first chunk arrive alone
    socket.write(frame.subarray(cut));
    await vi.waitFor(() => expect(frames.some((f) => (f as { id?: number }).id === 0)).toBe(true));

    const reader = await connectBoard({ socketPath, agentId: agentId("reader") });
    cleanups.push(() => reader.close());
    const slice = await reader.read({ root: "f1", depth: 1 });
    expect(slice.ok).toBe(true);
    if (slice.ok) expect(slice.value.nodes[0]?.props.text).toBe(HEBREW);
  });

  it("client inbound: a res frame cut mid-character delivers the exact Hebrew text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "w3utf8-"));
    const socketPath = join(dir, "b.sock");

    // A scripted board: ack the hello, then answer the first request with a res frame
    // written in two pieces, cut inside a Hebrew character.
    const fake = createServer((socket) => {
      let stage = 0;
      socket.on("data", () => {
        stage++;
        if (stage === 1) {
          socket.write(encodeFrame({ kind: "ready" }));
          return;
        }
        const res = Buffer.from(
          encodeFrame({
            kind: "res",
            id: 0,
            result: {
              ok: true,
              value: {
                nodes: [{ id: "f1", label: "CodeFile", props: { text: HEBREW }, version: 1 }],
                edges: [],
              },
            },
          }),
          "utf8",
        );
        const cut = splitInsideChar(res);
        socket.write(res.subarray(0, cut));
        setTimeout(() => socket.write(res.subarray(cut)), 30);
      });
    });
    await new Promise<void>((r) => fake.listen(socketPath, () => r()));
    cleanups.push(() => new Promise<void>((r) => fake.close(() => r())));

    const board = await connectBoard({ socketPath, agentId: agentId("reader") });
    cleanups.push(() => board.close());
    const slice = await board.read({ root: "f1", depth: 1 });
    expect(slice.ok).toBe(true);
    if (slice.ok) expect(slice.value.nodes[0]?.props.text).toBe(HEBREW);
  });
});
