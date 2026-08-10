import { mkdirSync } from "node:fs";
import { agentId } from "@whipple3/core";
import { createJsonlLog } from "@whipple3/log";
import { createSession, liveSessionDeps, serveStdio } from "@whipple3/transport-mcp";
import { defineCommand } from "citty";

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
  },
  async run({ args }) {
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
