import { mkdirSync } from "node:fs";
import { createJsonlLog } from "@whipple3/log";
import { createSession, liveSessionDeps } from "@whipple3/transport-mcp";
import { startBoardServer } from "@whipple3/transport-uds";
import { defineCommand } from "citty";

/**
 * The shared-state backend (ADR-005 amendment, ruling D1): ONE process owns the
 * session and the log; each `whipple3 mcp --board` proxy is one socket = one agent.
 */
export const serve = defineCommand({
  meta: {
    name: "serve",
    description: "Start the shared board backend: one session, served on a UDS socket.",
  },
  args: {
    socket: {
      type: "string",
      description: "Socket path the board listens on; mcp proxies dial it via --board.",
      default: ".whipple3/board.sock",
    },
  },
  async run({ args }) {
    mkdirSync(".whipple3", { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const logPath = `.whipple3/session-${stamp}.ndjson`;
    const session = createSession({
      log: createJsonlLog(logPath),
      // v0.1: the host's tool allowlist is the gate; schema-level ACL config arrives with the plugin demo.
      acl: null,
      ...liveSessionDeps(),
    });
    const server = await startBoardServer({ session, socketPath: args.socket });
    const shutdown = async (): Promise<void> => {
      await server.close(); // hangs up every proxy, then unlinks the socket
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    console.log(`whipple3 serve: board listening on ${args.socket} — log ${logPath}`);
  },
});
