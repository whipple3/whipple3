import { userInfo } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { err, ok, type Principal, principal, type Result, sessionId, txId } from "@whipple3/core";
import { ulid } from "ulid";
import type { AgentConnection, SessionDeps } from "./session.js";
import { toolDescriptions, toolInputs } from "./tools.js";

/** Every tool answers with a serialized Result — structured data, never prose. (SPEC §6) */
const asToolResult = (r: Result<unknown, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(r) }],
  isError: !r.ok,
});

/**
 * A dead backend is a structured error to the host, never a stack trace over stdio.
 * Only the socket-proxied connection throws in practice (its board can die mid-call);
 * an in-process connection speaks Results throughout.
 */
const guarded = async (call: () => Promise<Result<unknown, unknown>>) => {
  try {
    return asToolResult(await call());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return asToolResult(err({ code: "BOARD_UNREACHABLE", message }));
  }
};

/**
 * One server per connection, already bound to its agent (`session.connect`): the MCP
 * transport is the identity boundary, so no tool payload carries an agentId. (SPEC §4.6)
 * The SDK validates against the same schemas it advertises; session re-parses the raw
 * object because its own boundary is `unknown` (tests and future transports call it directly).
 * `connection` may equally be a RemoteAgentConnection — the six-op surface is identical
 * (status went async in W2-B precisely so a socket proxy could honor it), which keeps
 * this the ONE registration site for tools, schemas and descriptions on every transport.
 */
export const createServer = (connection: AgentConnection): McpServer => {
  const server = new McpServer({ name: "whipple3", version: "0.1.0" });

  server.registerTool(
    "blackboard_post",
    { description: toolDescriptions.blackboard_post, inputSchema: toolInputs.blackboard_post },
    (args) => guarded(() => connection.post(args)),
  );

  server.registerTool(
    "blackboard_read",
    { description: toolDescriptions.blackboard_read, inputSchema: toolInputs.blackboard_read },
    (args) => guarded(() => connection.read(args)),
  );

  server.registerTool(
    "blackboard_claim",
    { description: toolDescriptions.blackboard_claim, inputSchema: toolInputs.blackboard_claim },
    (args) => guarded(() => connection.claim(args)),
  );

  server.registerTool(
    "blackboard_release",
    {
      description: toolDescriptions.blackboard_release,
      inputSchema: toolInputs.blackboard_release,
    },
    (args) => guarded(() => connection.release(args)),
  );

  server.registerTool(
    "blackboard_next",
    { description: toolDescriptions.blackboard_next, inputSchema: toolInputs.blackboard_next },
    (args) => guarded(() => connection.next(args)),
  );

  server.registerTool(
    "blackboard_status",
    { description: toolDescriptions.blackboard_status, inputSchema: toolInputs.blackboard_status },
    () => guarded(async () => ok(await connection.status())),
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

export const serveStdio = async (connection: AgentConnection): Promise<void> => {
  await createServer(connection).connect(new StdioServerTransport());
};
