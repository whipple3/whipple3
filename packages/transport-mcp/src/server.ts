import { userInfo } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ok, type Principal, principal, type Result, sessionId, txId } from "@whipple3/core";
import { ulid } from "ulid";
import type { AgentConnection, SessionDeps } from "./session.js";
import { toolInputs } from "./tools.js";

/** Every tool answers with a serialized Result — structured data, never prose. (SPEC §6) */
const asToolResult = (r: Result<unknown, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(r) }],
  isError: !r.ok,
});

/**
 * One server per connection, already bound to its agent (`session.connect`): the MCP
 * transport is the identity boundary, so no tool payload carries an agentId. (SPEC §4.6)
 * The SDK validates against the same schemas it advertises; session re-parses the raw
 * object because its own boundary is `unknown` (tests and future transports call it directly).
 */
export const createServer = (session: AgentConnection): McpServer => {
  const server = new McpServer({ name: "whipple3", version: "0.0.0" });

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
    async (args) => asToolResult(await session.read(args)),
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
    "blackboard_release",
    {
      description: "Release this connection's own lease on a node before its ttl expires.",
      inputSchema: toolInputs.blackboard_release,
    },
    async (args) => asToolResult(await session.release(args)),
  );

  server.registerTool(
    "blackboard_next",
    {
      description: "Pull the next pending work item for a label, skipping claimed nodes.",
      inputSchema: toolInputs.blackboard_next,
    },
    async (args) => asToolResult(await session.next(args)),
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

/** WHIPPLE3_PRINCIPAL is the injection hook (enterprise: SSO); OSS default is the OS user. */
const localPrincipal = (): Principal | null => {
  const injected = process.env.WHIPPLE3_PRINCIPAL;
  if (injected !== undefined && injected !== "") return principal(injected);
  try {
    return principal(userInfo().username);
  } catch {
    return null;
  }
};

/** Production identity and time for a session; tests inject their own. */
export const liveSessionDeps = (): Pick<
  SessionDeps,
  "sessionId" | "principal" | "now" | "newTxId"
> => ({
  sessionId: sessionId(ulid()),
  principal: localPrincipal(),
  now: Date.now,
  newTxId: () => txId(ulid()),
});

export const serveStdio = async (session: AgentConnection): Promise<void> => {
  await createServer(session).connect(new StdioServerTransport());
};
