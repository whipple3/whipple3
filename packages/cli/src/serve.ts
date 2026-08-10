import { mkdirSync, readFileSync } from "node:fs";
import { createJsonlLog } from "@whipple3/log";
import {
  createSession,
  liveSessionDeps,
  type PolicyConfig,
  parsePolicy,
} from "@whipple3/transport-mcp";
import { startBoardServer } from "@whipple3/transport-uds";
import { defineCommand } from "citty";

/** Process edge: a bad policy file must stop the board before it serves anyone. */
const loadPolicy = (path: string): PolicyConfig => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`whipple3 serve: cannot read policy ${path}: ${String(e)}`);
    process.exit(1);
  }
  const parsed = parsePolicy(raw);
  if (!parsed.ok) {
    for (const issue of parsed.error.issues)
      console.error(`whipple3 serve: policy ${path}: ${issue.path}: ${issue.message}`);
    process.exit(1);
  }
  return parsed.value;
};

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
    policy: {
      type: "string",
      description:
        "JSON policy file: { acl?: {agent: {write, read}}, slices?: {agent: SliceDecl} }. " +
        "Without it the host's tool allowlist is the only gate.",
    },
  },
  async run({ args }) {
    const policy: PolicyConfig =
      args.policy !== undefined ? loadPolicy(args.policy) : { acl: null };
    mkdirSync(".whipple3", { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const logPath = `.whipple3/session-${stamp}.ndjson`;
    const session = createSession({
      log: createJsonlLog(logPath),
      acl: policy.acl,
      slices: policy.slices,
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
