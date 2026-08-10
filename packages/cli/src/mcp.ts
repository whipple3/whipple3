import { mkdirSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { agentId, err, ok, type Result } from "@whipple3/core";
import { createJsonlLog } from "@whipple3/log";
import { createSession, liveSessionDeps, serveStdio, toolInputs } from "@whipple3/transport-mcp";
import { connectBoard, type RemoteAgentConnection } from "@whipple3/transport-uds";
import { defineCommand } from "citty";

/** Mirrors transport-mcp's answer shape: a serialized Result, never prose. (SPEC §6) */
const asToolResult = (r: Result<unknown, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(r) }],
  isError: !r.ok,
});

/** A dead backend is a structured error to the host, not a stack trace. */
const viaBoard = async (call: () => Promise<Result<unknown, unknown>>) => {
  try {
    return asToolResult(await call());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return asToolResult(err({ code: "BOARD_UNREACHABLE", message }));
  }
};

/**
 * The stdio↔socket proxy: same six tools, same frozen schemas, but every call crosses
 * the board socket that carries THIS process's --agent identity (ADR-007 over UDS).
 * Registration is redone here rather than reusing transport-mcp's createServer because
 * the remote surface differs in exactly one way: status() cannot stay synchronous
 * across a socket, so its handler awaits.
 */
const serveStdioProxy = async (board: RemoteAgentConnection): Promise<void> => {
  const server = new McpServer({ name: "whipple3", version: "0.0.0" });
  server.registerTool(
    "blackboard_post",
    {
      description: "Submit a typed, versioned mutation (schema + ACL validated).",
      inputSchema: toolInputs.blackboard_post,
    },
    (args) => viaBoard(() => board.post(args)),
  );
  server.registerTool(
    "blackboard_read",
    {
      description: "Read a scoped slice: the neighborhood of a root node.",
      inputSchema: toolInputs.blackboard_read,
    },
    (args) => viaBoard(() => board.read(args)),
  );
  server.registerTool(
    "blackboard_claim",
    {
      description: "Claim/lease a node for exclusive work until the ttl expires.",
      inputSchema: toolInputs.blackboard_claim,
    },
    (args) => viaBoard(() => board.claim(args)),
  );
  server.registerTool(
    "blackboard_release",
    {
      description: "Release this connection's own lease on a node before its ttl expires.",
      inputSchema: toolInputs.blackboard_release,
    },
    (args) => viaBoard(() => board.release(args)),
  );
  server.registerTool(
    "blackboard_next",
    {
      description: "Pull the next pending work item for a label, skipping claimed nodes.",
      inputSchema: toolInputs.blackboard_next,
    },
    (args) => viaBoard(() => board.next(args)),
  );
  server.registerTool(
    "blackboard_status",
    {
      description: "Session summary: node/edge/claim counts by label.",
      inputSchema: toolInputs.blackboard_status,
    },
    () => viaBoard(async () => ok(await board.status())),
  );
  await server.connect(new StdioServerTransport());
};

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
      const board = await connectBoard({ socketPath: args.board, agentId: agentId(args.agent) });
      // stdout is the MCP wire from here on — nothing else may print to it.
      await serveStdioProxy(board);
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
    await serveStdio(session.connect(agentId(args.agent)));
  },
});
