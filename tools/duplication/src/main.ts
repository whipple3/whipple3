#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { Lens } from "@whipple3/transcript";
import { loadSession } from "@whipple3/transcript";
import { callsOf, type LensResult, measure } from "./measure.js";

/**
 * How much of a multi-agent session's work was paid for more than once.
 *
 *   duplication <session.jsonl>      one session, with hotspots
 *   duplication --all [minAgents=4]  every multi-agent session under ~/.claude/projects
 *
 * Read-only; nothing leaves the machine. The three lenses are always printed together —
 * the measurement exists to resist quoting whichever denominator flatters the result.
 */
const LENSES: readonly Lens[] = ["all", "lookups", "reads"];

const pct = (r: LensResult): string =>
  r.comparable === 0 ? "  n/a" : `${(r.share * 100).toFixed(1)}%`.padStart(6);

const subagentCount = (session: string): number => {
  const dir = join(session.slice(0, -extname(session).length), "subagents");
  const walk = (d: string): number =>
    readdirSync(d, { withFileTypes: true }).reduce(
      (n, e) =>
        n +
        (e.isDirectory()
          ? walk(join(d, e.name))
          : e.name.startsWith("agent-") && e.name.endsWith(".jsonl")
            ? 1
            : 0),
      0,
    );
  return existsSync(dir) ? walk(dir) : 0;
};

const sessionsUnder = (root: string, minAgents: number): readonly string[] =>
  !existsSync(root)
    ? []
    : readdirSync(root)
        .flatMap((project) => {
          const dir = join(root, project);
          if (!statSync(dir).isDirectory()) return [];
          return readdirSync(dir)
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => join(dir, f));
        })
        .filter((s) => subagentCount(s) >= minAgents)
        .sort();

const one = (session: string): void => {
  const agents = loadSession(session);
  const calls = callsOf(agents);
  console.log(`${basename(session)} — ${agents.length} agents · ${calls.length} comparable calls`);
  for (const lens of LENSES) {
    const r = measure(calls, lens);
    console.log(`  ${lens.padEnd(8)} ${pct(r)}  (${r.repaid} of ${r.comparable})`);
  }
  console.log("  most-repeated targets:");
  for (const h of measure(calls, "all").hotspots)
    console.log(`    ${String(h.agents).padStart(3)} agents · ${h.tool} · ${h.target}`);
};

const census = (minAgents: number): void => {
  const sessions = sessionsUnder(join(homedir(), ".claude", "projects"), minAgents);
  const totals = new Map<Lens, { comparable: number; repaid: number }>(
    LENSES.map((l) => [l, { comparable: 0, repaid: 0 }]),
  );
  let agentTotal = 0;
  const rows: { name: string; agents: number; share: number }[] = [];

  for (const session of sessions) {
    const agents = loadSession(session);
    const calls = callsOf(agents);
    agentTotal += agents.length;
    for (const lens of LENSES) {
      const r = measure(calls, lens);
      const t = totals.get(lens);
      if (t !== undefined) {
        t.comparable += r.comparable;
        t.repaid += r.repaid;
      }
    }
    rows.push({
      name: basename(session, ".jsonl").slice(0, 8),
      agents: agents.length,
      share: measure(calls, "all").share,
    });
  }

  for (const row of rows.sort((a, b) => b.share - a.share))
    console.log(
      `${row.name}  agents=${String(row.agents).padStart(4)}  ${(row.share * 100).toFixed(1).padStart(5)}%`,
    );
  console.log(`\n${sessions.length} sessions · ${agentTotal} agents (min ${minAgents} subagents)`);
  for (const lens of LENSES) {
    const t = totals.get(lens);
    if (t === undefined) continue;
    const share = t.comparable === 0 ? 0 : (t.repaid / t.comparable) * 100;
    console.log(`  ${lens.padEnd(8)} ${share.toFixed(1)}%  (${t.repaid} of ${t.comparable})`);
  }
  console.log("\nOne machine, one developer. This is a census of it, not a sample of anyone else.");
};

const [arg, second] = process.argv.slice(2);
if (arg === undefined) {
  console.error("usage: duplication <session.jsonl> | duplication --all [minAgents]");
  process.exit(1);
} else if (arg === "--all") census(Number(second ?? 4));
else if (!existsSync(arg)) {
  console.error(`duplication: no such transcript ${arg}`);
  process.exit(1);
} else one(arg);
