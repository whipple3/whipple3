import { ok, type Result, sessionId, txId } from "@arai/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ulid } from "ulid";
import type { Session, SessionDeps } from "./session.js";
import { toolInputs } from "./tools.js";

/** Every tool answers with a serialized Result — structured data, never prose. (SPEC §6) */
const asToolResult = (r: Result<unknown, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(r) }],
  isError: !r.ok,
});

/**
 * The SDK validates against the same schemas it advertises; session re-parses the raw
 * object because its own boundary is `unknown` (tests and future transports call it directly).
 */
export const createServer = (session: Session): McpServer => {
  const server = new McpServer({ name: "arai", version: "0.0.0" });

  server.registerTool(
    "blackboard_post",
    {
      description: "Submit a typed, versioned mutation (schema + ACL validated).",
      inputSchema: toolInputs.blackboard_post,
    },
    async (args) => asToolResult(await session.post(args)),
  );

  server.registerTool(
    "blackboard_read",
    {
      description: "Read a scoped slice: the neighborhood of a root node.",
      inputSchema: toolInputs.blackboard_read,
    },
    (args) => asToolResult(session.read(args)),
  );

  server.registerTool(
    "blackboard_claim",
    {
      description: "Claim/lease a node for exclusive work until the ttl expires.",
      inputSchema: toolInputs.blackboard_claim,
    },
    async (args) => asToolResult(await session.claim(args)),
  );

  server.registerTool(
    "blackboard_next",
    {
      description: "Pull the next pending work item for a label, skipping claimed nodes.",
      inputSchema: toolInputs.blackboard_next,
    },
    (args) => asToolResult(session.next(args)),
  );

  server.registerTool(
    "blackboard_status",
    {
      description: "Session summary: node/edge/claim counts by label.",
      inputSchema: toolInputs.blackboard_status,
    },
    () => asToolResult(ok(session.status())),
  );

  return server;
};

/** Production identity and time for a session; tests inject their own. */
export const liveSessionDeps = (): Pick<SessionDeps, "sessionId" | "now" | "newTxId"> => ({
  sessionId: sessionId(ulid()),
  now: Date.now,
  newTxId: () => txId(ulid()),
});

export const serveStdio = async (session: Session): Promise<void> => {
  await createServer(session).connect(new StdioServerTransport());
};
