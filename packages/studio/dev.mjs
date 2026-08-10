#!/usr/bin/env node
/**
 * Studio dev entry (plain JS process edge). Vite serves the page; a plugin
 * middleware serves /events; the TS server modules are loaded through Vite's
 * SSR runner because the workspace packages export TypeScript source.
 *
 *   pnpm --filter @whipple3/studio dev -- <session.ndjson>
 *   WHIPPLE3_LOG=<session.ndjson> pnpm --filter @whipple3/studio dev
 *   pnpm --filter @whipple3/studio dev:fixture   # self-generating demo log
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const fixture = process.env.WHIPPLE3_FIXTURE === "1";
// pnpm forwards a literal "--" separator; never mistake it for the log path.
const argPath = process.argv.slice(2).find((a) => a !== "--");
const givenPath = argPath ?? process.env.WHIPPLE3_LOG;

if (givenPath === undefined && !fixture) {
  console.error("usage: pnpm --filter @whipple3/studio dev -- <session.ndjson>");
  console.error("   or: WHIPPLE3_LOG=<session.ndjson> pnpm --filter @whipple3/studio dev");
  console.error("   or: pnpm --filter @whipple3/studio dev:fixture");
  process.exit(1);
}

const logPath =
  givenPath !== undefined
    ? resolve(givenPath)
    : join(mkdtempSync(join(tmpdir(), "whipple3-studio-demo-")), "session.ndjson");

let handlerReady;
const handler = new Promise((resolveHandler) => {
  handlerReady = resolveHandler;
});

const server = await createServer({
  root,
  configFile: false,
  server: { port: 4177 },
  ssr: { noExternal: [/^@whipple3\//] },
  plugins: [
    {
      name: "whipple3-studio-events",
      configureServer(s) {
        // configureServer registers BEFORE Vite's internal middlewares — an
        // appended-after-listen middleware would sit behind the 404 handler.
        s.middlewares.use("/events", (req, res) => {
          void handler.then((handle) => handle(req, res));
        });
      },
    },
  ],
});

/** Vite 6+ module runner, with the legacy ssrLoadModule as fallback. */
const load = (path) => {
  const ssrEnvironment = server.environments?.ssr;
  if (ssrEnvironment?.runner) return ssrEnvironment.runner.import(path);
  return server.ssrLoadModule(path);
};

const { createEventsHandler } = await load("/src/attach.ts");
handlerReady(createEventsHandler(logPath));

if (fixture) {
  const { runFixture } = await load("/src/fixture.ts");
  runFixture(logPath).catch((error) => console.error("[studio] fixture failed:", error));
}

await server.listen();
server.printUrls();
console.log(`[studio] tailing ${logPath}`);
