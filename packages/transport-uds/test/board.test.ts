import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { connect, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentId, principal, sessionId, txId } from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { createSession } from "@whipple3/transport-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectBoard } from "../src/client.js";
import { createLineBuffer, encodeFrame } from "../src/frames.js";
import { startBoardServer } from "../src/server.js";

const socketPathIn = (dir: string) => join(dir, "b.sock");

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const makeBoard = async () => {
  const dir = mkdtempSync(join(tmpdir(), "w3uds-"));
  let now = 0;
  let n = 0;
  const log = createMemoryLog();
  const session = createSession({
    log,
    acl: null,
    sessionId: sessionId("s1"),
    principal: principal("michael"),
    now: () => now,
    newTxId: () => txId(`tx${n++}`),
  });
  const socketPath = socketPathIn(dir);
  const server = await startBoardServer({ session, socketPath });
  cleanups.push(() => server.close());
  return { socketPath, log, server, tick: (ms: number) => (now += ms) };
};

const client = async (socketPath: string, agent: string) => {
  const c = await connectBoard({ socketPath, agentId: agentId(agent) });
  cleanups.push(() => c.close());
  return c;
};

const postFile = (id: string) => ({
  mutation: { kind: "ADD_NODE", id, label: "CodeFile", props: { status: "pending" } },
});

/** Raw socket + collected server frames, for protocol-level (non-client) assertions. */
const rawSocket = (socketPath: string) => {
  const socket = connect(socketPath);
  const frames: unknown[] = [];
  const push = createLineBuffer();
  socket.on("data", (chunk) => {
    for (const line of push(chunk.toString("utf8"))) frames.push(JSON.parse(line));
  });
  cleanups.push(() => {
    socket.destroy();
  });
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  return { socket, frames, closed };
};

describe("board server — identity binds at the hello frame (ADR-007 over UDS)", () => {
  it("attributes a post to the agent the SOCKET declared, in state echo and log meta", async () => {
    const { socketPath, log } = await makeBoard();
    const poster = await client(socketPath, "poster");
    const r = await poster.post(postFile("f1"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.version).toBe(1);
    const records = await log.read();
    expect(records).toHaveLength(1);
    expect(records[0]?.meta.agentId).toBe("poster");
    expect(records[0]?.meta.principal).toBe("michael");
  });

  it("cross-connection claim: ALREADY_CLAIMED names the true holder from the OTHER socket", async () => {
    const { socketPath } = await makeBoard();
    const poster = await client(socketPath, "poster");
    const claimer = await client(socketPath, "claimer");
    await poster.post(postFile("f1"));

    expect((await claimer.claim({ id: "f1", ttlMs: 1000 })).ok).toBe(true);
    const contested = await poster.claim({ id: "f1", ttlMs: 1000 });
    expect(contested.ok).toBe(false);
    if (!contested.ok && contested.error.code === "ALREADY_CLAIMED") {
      expect(contested.error.holder).toBe("claimer");
    } else {
      throw new Error("expected ALREADY_CLAIMED naming 'claimer'");
    }
  });

  it("maps the full AgentConnection surface 1:1: next, read, release, status", async () => {
    const { socketPath } = await makeBoard();
    const poster = await client(socketPath, "poster");
    const claimer = await client(socketPath, "claimer");
    await poster.post(postFile("f1"));

    const found = await claimer.next({ label: "CodeFile", match: { status: "pending" } });
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value.node?.id).toBe("f1");

    await claimer.claim({ id: "f1", ttlMs: 1000 });
    const released = await claimer.release({ id: "f1" });
    expect(released.ok).toBe(true);

    const slice = await poster.read({ root: "f1", depth: 1 });
    expect(slice.ok).toBe(true);
    if (slice.ok) expect(slice.value.nodes.map((n) => n.id)).toEqual(["f1"]);

    expect(await poster.status()).toEqual({
      nodes: 1,
      edges: 0,
      activeClaims: 0,
      byLabel: { CodeFile: 1 },
    });
  });

  it("session-level errors travel as Result values, not exceptions", async () => {
    const { socketPath } = await makeBoard();
    const poster = await client(socketPath, "poster");
    const r = await poster.post({ mutation: { kind: "EXPLODE" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_ERROR");
  });
});

describe("board server — protocol errors are structured frames, never prose", () => {
  it("a request before hello is refused with HELLO_REQUIRED and the socket closes", async () => {
    const { socketPath } = await makeBoard();
    const { socket, frames, closed } = rawSocket(socketPath);
    socket.write('{"kind":"req","id":0,"op":"status"}\n');
    await closed;
    expect(frames).toEqual([{ kind: "err", id: null, error: { code: "HELLO_REQUIRED" } }]);
  });

  it("an unparseable line is refused with BAD_FRAME and the socket closes", async () => {
    const { socketPath } = await makeBoard();
    const { socket, frames, closed } = rawSocket(socketPath);
    socket.write("not json at all\n");
    await closed;
    expect(frames).toEqual([{ kind: "err", id: null, error: { code: "BAD_FRAME" } }]);
  });

  it("a runaway line is refused with BAD_FRAME instead of buffered without bound", async () => {
    const { socketPath } = await makeBoard();
    const { socket, frames, closed } = rawSocket(socketPath);
    // 9Mi units with no newline — past the buffer cap, nowhere near an OOM.
    socket.write("x".repeat(9 * 1024 * 1024));
    await closed;
    expect(frames).toEqual([{ kind: "err", id: null, error: { code: "BAD_FRAME" } }]);
  });

  it("a second hello on a bound connection is BAD_FRAME — one socket, one identity", async () => {
    const { socketPath } = await makeBoard();
    const { socket, frames, closed } = rawSocket(socketPath);
    socket.write(encodeFrame({ kind: "hello", v: 1, agentId: "a" }));
    socket.write(encodeFrame({ kind: "hello", v: 1, agentId: "b" }));
    await closed;
    expect(frames).toEqual([
      { kind: "ready" },
      { kind: "err", id: null, error: { code: "BAD_FRAME" } },
    ]);
  });
});

describe("board server — one identity, at most one live connection (D2 corollary)", () => {
  it("refuses a second live connection for an already-bound identity", async () => {
    const { socketPath } = await makeBoard();
    await client(socketPath, "auditor-1");
    // Two workers sharing an identity would renew each other's leases — the claim
    // protection dissolves. The board refuses mechanically, not by instruction.
    await expect(connectBoard({ socketPath, agentId: agentId("auditor-1") })).rejects.toThrow(
      /IDENTITY_IN_USE/,
    );
  });

  it("a refused hello does not evict the live holder", async () => {
    const { socketPath } = await makeBoard();
    const holder = await client(socketPath, "auditor-1");
    await expect(connectBoard({ socketPath, agentId: agentId("auditor-1") })).rejects.toThrow();
    expect((await holder.post(postFile("f1"))).ok).toBe(true);
  });

  it("frees the identity when its connection closes", async () => {
    const { socketPath } = await makeBoard();
    const first = await client(socketPath, "auditor-1");
    first.close();
    // The server observes the close asynchronously; the rebind may need a beat.
    await vi.waitFor(async () => {
      const again = await connectBoard({ socketPath, agentId: agentId("auditor-1") });
      cleanups.push(() => again.close());
      expect((await again.status()).nodes).toBe(0);
    });
  });
});

describe("board server — socket path lifecycle", () => {
  it("close() unlinks the socket and later client calls reject at the process edge", async () => {
    const { socketPath, server } = await makeBoard();
    const poster = await client(socketPath, "poster");
    await poster.post(postFile("f1"));
    await server.close();
    expect(existsSync(socketPath)).toBe(false);
    // Which teardown event wins the race decides the message; both mean "connection died".
    await expect(poster.status()).rejects.toThrow(/closed|ended by the other party/);
  });

  it("reclaims a stale socket file nobody is listening on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "w3uds-"));
    const socketPath = socketPathIn(dir);
    // A dead serve's real leftovers: closing a server does NOT unlink its socket file.
    const dead = createNetServer();
    await new Promise<void>((r) => dead.listen(socketPath, () => r()));
    await new Promise<void>((r) => dead.close(() => r()));
    const { log } = { log: createMemoryLog() };
    const session = createSession({
      log,
      acl: null,
      sessionId: sessionId("s2"),
      principal: null,
      now: () => 0,
      newTxId: () => txId("t"),
    });
    const server = await startBoardServer({ session, socketPath });
    cleanups.push(() => server.close());
    const c = await client(socketPath, "poster");
    expect((await c.post(postFile("f1"))).ok).toBe(true);
  });

  it("refuses a path holding a regular file — reclaim deletes sockets, never data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "w3uds-"));
    const socketPath = socketPathIn(dir);
    writeFileSync(socketPath, "someone's data, not a socket");
    const session = createSession({
      log: createMemoryLog(),
      acl: null,
      sessionId: sessionId("s2"),
      principal: null,
      now: () => 0,
      newTxId: () => txId("t"),
    });
    await expect(startBoardServer({ session, socketPath })).rejects.toThrow(/not a socket/);
    expect(existsSync(socketPath)).toBe(true); // the file was not collateral damage
  });

  it("refuses the path while a live server owns it — one board per socket", async () => {
    const { socketPath, server } = await makeBoard();
    const session = createSession({
      log: createMemoryLog(),
      acl: null,
      sessionId: sessionId("s3"),
      principal: null,
      now: () => 0,
      newTxId: () => txId("t"),
    });
    await expect(startBoardServer({ session, socketPath })).rejects.toThrow(/already/);
    await server.close(); // the loser must not have unlinked the winner's socket
  });
});
