import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventsHandler, runFixture } from "@whipple3/studio";
import { latestSession, loadSession, projectSession } from "@whipple3/transcript";
import { defineCommand } from "citty";

/** Built by the studio package, copied next to the bin by tsup's onSuccess. */
const ASSETS = resolve(fileURLToPath(new URL("./studio/", import.meta.url)));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const sendAsset = (urlPath: string, res: ServerResponse): void => {
  const file = resolve(ASSETS, urlPath === "/" ? "index.html" : urlPath.slice(1));
  // The URL is attacker-controlled in exactly one sense — a stray `..` — and the
  // studio serves a local session log, so the guard is cheap insurance either way.
  if (!file.startsWith(`${ASSETS}${sep}`) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
};

/** Best-effort: a failed opener must never take the server down with it. */
const openBrowser = (url: string): void => {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(opener, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {
    // Headless box, no opener on PATH — the printed URL is the fallback.
  }
};

/**
 * Read-only, and it never leaves the machine: the transcript holds the developer's own
 * prompts and outputs. The projection is written to a temp log so `replay` and `distill`
 * work on it too.
 */
const projectTranscript = (given: string): string | null => {
  const source = given === "" ? latestSession() : resolve(given);
  if (source === null) {
    console.error("whipple3 studio: no Claude Code session found under ~/.claude/projects.");
    return null;
  }
  if (!existsSync(source)) {
    console.error(`whipple3 studio: no such transcript ${source}`);
    return null;
  }
  const projection = projectSession(loadSession(source));
  const out = join(mkdtempSync(join(tmpdir(), "whipple3-session-")), "projected.ndjson");
  writeFileSync(out, `${projection.records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");

  console.log(`whipple3 studio: ${source}`);
  console.log(
    `  ${projection.agents} agents (${projection.subagents} subagents) · ` +
      `${projection.calls} tool calls · ${projection.sharedTargets} targets touched by more ` +
      `than one agent (${projection.sharedCalls} calls)`,
  );
  console.log(`  projected log: ${out}`);
  return out;
};

/**
 * The live graph over a session log: full replay on connect, then SSE tail.
 *
 * Three sources, in ascending order of how much they ask of you: `--demo` (a fixture, no
 * setup at all), `--session` (a Claude Code transcript you already have on disk), and a
 * whipple3 log from a real board.
 */
export const studio = defineCommand({
  meta: {
    name: "studio",
    description: "Watch a session log as a live graph: claims, history, time travel.",
  },
  args: {
    log: { type: "positional", required: false, description: "Path to a session ndjson log." },
    demo: { type: "boolean", default: false, description: "Run a self-generating demo session." },
    session: {
      type: "string",
      description:
        "Project a Claude Code transcript instead: a path, or bare --session for your latest.",
    },
    port: { type: "string", default: "4177", description: "Port to listen on." },
    open: { type: "boolean", default: true, description: "Open a browser (--no-open to skip)." },
  },
  run({ args }) {
    if (!existsSync(ASSETS)) {
      console.error("whipple3 studio: assets missing — run `pnpm build` from the repo root.");
      process.exit(1);
    }
    const sources = [args.log !== undefined, args.demo, args.session !== undefined].filter(Boolean);
    if (sources.length !== 1) {
      console.error("whipple3 studio: pass exactly one of <log>, --demo, --session.");
      process.exit(1);
    }

    let logPath: string;
    if (args.session !== undefined) {
      const projected = projectTranscript(args.session);
      if (projected === null) process.exit(1);
      logPath = projected;
    } else if (args.log === undefined) {
      logPath = join(mkdtempSync(join(tmpdir(), "whipple3-studio-demo-")), "session.ndjson");
    } else {
      logPath = resolve(args.log);
      if (!existsSync(logPath)) {
        console.error(`whipple3 studio: no such log ${logPath}`);
        process.exit(1);
      }
    }

    const port = Number(args.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`whipple3 studio: bad port ${args.port}`);
      process.exit(1);
    }

    // Handler first, fixture second: the tail must be watching before the demo writes.
    const events = createEventsHandler(logPath);
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/events") events(req, res);
      else sendAsset(path, res);
    });

    server.on("error", (error) => {
      console.error(`whipple3 studio: ${error.message}`);
      process.exit(1);
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      const source = args.demo
        ? "demo session"
        : args.session !== undefined
          ? "projected"
          : logPath;
      console.log(`whipple3 studio: ${url} — ${source}`);
      if (args.demo) void runFixture(logPath).catch((e: unknown) => console.error("[demo]", e));
      if (args.open) openBrowser(url);
    });

    const shutdown = (): void => {
      server.close(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  },
});
