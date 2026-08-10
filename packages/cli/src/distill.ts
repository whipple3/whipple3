import { existsSync, writeFileSync } from "node:fs";
import { createJsonlLog } from "@whipple3/log";
import { renderReport, summarize } from "@whipple3/transport-mcp";
import { defineCommand } from "citty";

const defaultOut = (logPath: string): string =>
  logPath.endsWith(".ndjson")
    ? `${logPath.slice(0, -".ndjson".length)}.report.md`
    : `${logPath}.report.md`;

/**
 * The LOG is the input: distill is a post-mortem fold over the source of truth,
 * needing no live session — tier 3 of the lifecycle, from tier 2 alone. (SPEC §4.2, §4.3)
 */
export const distill = defineCommand({
  meta: {
    name: "distill",
    description: "Fold a session log into a markdown report (findings, agent activity).",
  },
  args: {
    log: { type: "positional", description: "Path to a session .ndjson log", required: true },
    out: {
      type: "string",
      description: "Report output path (default: the log path with .ndjson → .report.md)",
    },
  },
  async run({ args }) {
    if (!existsSync(args.log)) {
      console.error(`whipple3 distill: no such log: ${args.log}`);
      process.exitCode = 1;
      return;
    }
    const records = await createJsonlLog(args.log).read();
    const out = args.out ?? defaultOut(args.log);
    writeFileSync(out, renderReport(summarize(records)), "utf8");
    console.log(`whipple3 distill: ${records.length} records → ${out}`);
  },
});
