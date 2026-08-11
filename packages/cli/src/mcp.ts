import { mkdirSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { agentId } from "@whipple3/core";
import { createJsonlLog } from "@whipple3/log";
import { createServer, createSession, liveSessionDeps, serveStdio } from "@whipple3/transport-mcp";
import { connectBoard } from "@whipple3/transport-uds";
import { defineCommand } from "citty";
import { VERSION } from "./version.js";

export const mcp = defineCommand({
  meta: { name: "mcp", description: "Start the whipple3 blackboard MCP server on stdio." },
  args: {
    agent: {
      type: "string",
      description:
        "Agent identity bound to this connection (stdio: one server process per agent). " +
        "Default 'main' — the host's own multiplexed connection.",
      default: "main",
    },
    board: {
      type: "string",
      description:
        "Socket path of a running `whipple3 serve`. When set, this process becomes a thin " +
        "per-agent proxy onto the shared board and owns no session or log of its own.",
    },
  },
  async run({ args }) {
    if (args.board !== undefined) {
      // The stdio↔socket proxy is transport-mcp's own server over a remote connection:
      // RemoteAgentConnection satisfies the same six-op surface (status went async in
      // W2-B), so tools, schemas and descriptions have exactly one registration site.
      // A dead board surfaces as a structured BOARD_UNREACHABLE result, never prose.
      const board = await connectBoard({ socketPath: args.board, agentId: agentId(args.agent) });
      // stdout is the MCP wire from here on — nothing else may print to it.
      await createServer(board, VERSION).connect(new StdioServerTransport());
      return;
    }
    mkdirSync(".whipple3", { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const session = createSession({
      log: createJsonlLog(`.whipple3/session-${stamp}.ndjson`),
      // v0.1: the host's tool allowlist is the gate; schema-level ACL config arrives with the plugin demo.
      acl: null,
      ...liveSessionDeps(),
    });
    // stdout is the MCP wire from here on — nothing else may print to it.
    await serveStdio(session.connect(agentId(args.agent)), VERSION);
  },
});
