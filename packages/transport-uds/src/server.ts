import { existsSync } from "node:fs";
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
 * One socket = one agent: the first frame MUST be a hello, which binds
 * `session.connect(agentId)` to this connection for its whole life. (ADR-007)
 */
const serveConnection = (session: Session, socket: Socket): void => {
  let bound: AgentConnection | null = null;
  const push = createLineBuffer();
  const send = (frame: ServerFrame): void => {
    socket.write(encodeFrame(frame));
  };
  const refuse = (code: "BAD_FRAME" | "HELLO_REQUIRED"): void => {
    send({ kind: "err", id: null, error: { code } });
    socket.end(); // flush the refusal, then hang up — the stream is not trustworthy
  };

  const handle = (frame: ClientFrame): void => {
    if (frame.kind === "hello") {
      if (bound !== null) {
        refuse("BAD_FRAME"); // re-binding identity is never ok
        return;
      }
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

  socket.on("data", (chunk) => {
    for (const line of push(chunk.toString("utf8"))) {
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
  await claimSocketPath(opts.socketPath);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    serveConnection(opts.session, socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unlink(opts.socketPath).catch(() => undefined); // already gone is fine
    },
  };
};
