import { existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { agentId } from "@whipple3/core";
import type { AgentConnection, Session } from "@whipple3/transport-mcp";
import {
  type ClientFrame,
  clientFrame,
  createLineBuffer,
  encodeFrame,
  type ReqFrame,
  type ServerFrame,
} from "./frames.js";
import { assertUdsPath } from "./sunpath.js";

export interface BoardServerOptions {
  /** The ONE session this board owns; every socket becomes one `session.connect`. */
  readonly session: Session;
  readonly socketPath: string;
}

export interface BoardServer {
  /** Destroys open connections, stops listening, unlinks the socket path. */
  close(): Promise<void>;
}

/** true when something answers on the path; false when it is stale (or absent). */
const pathIsLive = (socketPath: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });

const claimSocketPath = async (socketPath: string): Promise<void> => {
  if (!existsSync(socketPath)) return;
  // Reclaim deletes a dead serve's SOCKET, never data: a mistyped --socket pointing
  // at a real file must fail loudly, not silently unlink it.
  if (!statSync(socketPath).isSocket())
    throw new Error(`refusing ${socketPath}: exists and is not a socket`);
  if (await pathIsLive(socketPath))
    throw new Error(`refusing ${socketPath}: a live board already listens there`);
  await unlink(socketPath); // leftovers of a killed serve — reclaim
};

const answer = async (conn: AgentConnection, req: ReqFrame): Promise<ServerFrame> => {
  switch (req.op) {
    case "post":
      return { kind: "res", id: req.id, result: await conn.post(req.input) };
    case "claim":
      return { kind: "res", id: req.id, result: await conn.claim(req.input) };
    case "release":
      return { kind: "res", id: req.id, result: await conn.release(req.input) };
    case "next":
      return { kind: "res", id: req.id, result: await conn.next(req.input) };
    case "read":
      return { kind: "res", id: req.id, result: await conn.read(req.input) };
    case "status":
      return { kind: "res", id: req.id, result: await conn.status() };
    default: {
      const exhaustive: never = req.op;
      throw new Error(`unreachable op ${String(exhaustive)}`);
    }
  }
};

/**
 * One socket = one agent, and one agent = at most one live socket: the first frame
 * MUST be a hello, which binds `session.connect(agentId)` to this connection for its
 * whole life (ADR-007); a hello for an identity another live socket already holds is
 * refused — two workers sharing a name would renew each other's leases (D2) and the
 * claim protection would dissolve.
 */
const serveConnection = (session: Session, socket: Socket, liveIdentities: Set<string>): void => {
  let bound: AgentConnection | null = null;
  let boundId: string | null = null;
  const push = createLineBuffer();
  const send = (frame: ServerFrame): void => {
    socket.write(encodeFrame(frame));
  };
  const refuse = (code: "BAD_FRAME" | "HELLO_REQUIRED" | "IDENTITY_IN_USE"): void => {
    send({ kind: "err", id: null, error: { code } });
    socket.end(); // flush the refusal, then hang up — the stream is not trustworthy
  };
  socket.once("close", () => {
    if (boundId !== null) liveIdentities.delete(boundId);
  });

  const handle = (frame: ClientFrame): void => {
    if (frame.kind === "hello") {
      if (bound !== null) {
        refuse("BAD_FRAME"); // re-binding identity is never ok
        return;
      }
      if (liveIdentities.has(frame.agentId)) {
        refuse("IDENTITY_IN_USE");
        return;
      }
      liveIdentities.add(frame.agentId);
      boundId = frame.agentId;
      bound = session.connect(agentId(frame.agentId));
      send({ kind: "ready" });
      return;
    }
    if (bound === null) {
      refuse("HELLO_REQUIRED");
      return;
    }
    const conn = bound;
    // Answers may interleave out of request order; the id correlates them.
    void answer(conn, frame)
      .then(send)
      .catch(() => send({ kind: "err", id: frame.id, error: { code: "INTERNAL" } }));
  };

  // setEncoding, not per-chunk toString: a multi-byte character split across two
  // 'data' events must be held by the StringDecoder, or it silently becomes U+FFFD.
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    let lines: string[];
    try {
      lines = push(chunk);
    } catch {
      return refuse("BAD_FRAME"); // runaway line — the buffer cap in frames.ts
    }
    for (const line of lines) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return refuse("BAD_FRAME");
      }
      const parsed = clientFrame.safeParse(raw);
      if (!parsed.success) return refuse("BAD_FRAME");
      handle(parsed.data);
    }
  });
  socket.on("error", () => socket.destroy()); // peer vanished; nothing left to answer
};

export const startBoardServer = async (opts: BoardServerOptions): Promise<BoardServer> => {
  // Bind the RESOLVED path, guarded: a deep path would bind fine relative and then
  // hand every absolute-path client a truncated ENOTSOCK. (sunpath.ts)
  const socketPath = assertUdsPath(opts.socketPath);
  await claimSocketPath(socketPath);
  const sockets = new Set<Socket>();
  const liveIdentities = new Set<string>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    serveConnection(opts.session, socket, liveIdentities);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unlink(socketPath).catch(() => undefined); // already gone is fine
    },
  };
};
