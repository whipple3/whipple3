import { connect } from "node:net";
import type { AgentId } from "@whipple3/core";
import type { AgentConnection, SessionStatus } from "@whipple3/transport-mcp";
import {
  createLineBuffer,
  encodeFrame,
  type Op,
  PROTOCOL_VERSION,
  type ServerFrame,
  serverFrame,
} from "./frames.js";
import { assertUdsPath, explainDialError } from "./sunpath.js";

export interface ConnectBoardOptions {
  readonly socketPath: string;
  /** The ONE identity this socket declares in its hello frame. (ADR-007) */
  readonly agentId: AgentId;
}

/**
 * The AgentConnection surface, remoted: the five ops keep their exact frozen
 * signatures (indexed off AgentConnection, so a contract drift breaks the build);
 * `status` alone turns async — a socket round-trip cannot be synchronous.
 */
export interface RemoteAgentConnection {
  readonly post: AgentConnection["post"];
  readonly claim: AgentConnection["claim"];
  readonly release: AgentConnection["release"];
  readonly next: AgentConnection["next"];
  readonly read: AgentConnection["read"];
  status(): Promise<SessionStatus>;
  close(): void;
}

interface Pending {
  readonly resolve: (result: unknown) => void;
  readonly reject: (e: Error) => void;
}

/** Resolves once the board acks the hello; rejections are process-edge exceptions. */
export const connectBoard = (opts: ConnectBoardOptions): Promise<RemoteAgentConnection> =>
  new Promise((resolveConnect, rejectConnect) => {
    let abs: string;
    try {
      abs = assertUdsPath(opts.socketPath);
    } catch (e) {
      rejectConnect(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const socket = connect(abs);
    const pending = new Map<number, Pending>();
    let ready = false;
    let nextId = 0;

    const failAll = (why: string): void => {
      const e = new Error(why);
      if (!ready) rejectConnect(e);
      for (const p of pending.values()) p.reject(e);
      pending.clear();
      socket.destroy();
    };

    const onFrame = (frame: ServerFrame): void => {
      if (frame.kind === "ready") {
        ready = true;
        resolveConnect(board);
        return;
      }
      if (frame.kind === "res") {
        pending.get(frame.id)?.resolve(frame.result);
        pending.delete(frame.id);
        return;
      }
      if (frame.id === null) {
        failAll(`board refused the connection: ${frame.error.code}`);
        return;
      }
      pending.get(frame.id)?.reject(new Error(`board refused the call: ${frame.error.code}`));
      pending.delete(frame.id);
    };

    const push = createLineBuffer();
    socket.on("data", (chunk) => {
      for (const line of push(chunk.toString("utf8"))) {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          return failAll("board sent an unparseable frame");
        }
        const parsed = serverFrame.safeParse(raw);
        if (!parsed.success) return failAll("board sent an unknown frame");
        onFrame(parsed.data);
      }
    });
    socket.on("error", (e) => failAll(explainDialError(abs, e as NodeJS.ErrnoException)));
    socket.on("close", () => failAll("board connection closed"));
    socket.once("connect", () =>
      socket.write(encodeFrame({ kind: "hello", v: PROTOCOL_VERSION, agentId: opts.agentId })),
    );

    const request = <T>(op: Op, input?: unknown): Promise<T> => {
      if (socket.destroyed) return Promise.reject(new Error("board connection closed"));
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        // The envelope was Zod-parsed above; the result payload is the AgentConnection
        // method's own return value, produced by this same codebase inside the serve
        // process. Re-validating it here would mean re-deriving every core Result
        // schema — a trusted same-repo boundary, so: one commented cast.
        pending.set(id, { resolve: (r) => resolve(r as T), reject });
        socket.write(encodeFrame({ kind: "req", id, op, input }));
      });
    };

    const board: RemoteAgentConnection = {
      post: (input) => request("post", input),
      claim: (input) => request("claim", input),
      release: (input) => request("release", input),
      next: (input) => request("next", input),
      read: (input) => request("read", input),
      status: () => request("status"),
      close: () => socket.destroy(),
    };
  });
