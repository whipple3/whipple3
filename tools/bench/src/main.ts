#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJsonlLog } from "@whipple3/log";
import { extractBoardMetrics } from "./board.js";
import { renderComparison } from "./compare.js";
import { mockVanillaSession, mockWhipple3Session, writeMockSession } from "./mock.js";
import { runAuditScenario } from "./scenario.js";
import { loadSessionMetrics } from "./subagents.js";

const USAGE = `usage:
  bench compare <whipple3.jsonl> <vanilla.jsonl> [--board <board.ndjson>] [--out <file.md>]
  bench mock <outDir>

compare  render the honest markdown comparison of two Claude Code session transcripts;
         --board adds duplicate-work + findings metrics from a whipple3 board log.
mock     prove the pipeline with NO LLM: spawn the real \`whipple3 serve\` + proxies for a
         fixed audit, synthesize a format-true transcript pair, write comparison.md.`;

interface Argv {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

const parseArgv = (args: readonly string[]): Argv => {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    flags[arg.slice(2)] = value;
    i++;
  }
  return { positionals, flags };
};

const boardMetrics = async (path: string | undefined) =>
  path === undefined ? null : extractBoardMetrics(await createJsonlLog(path).read());

const compare = async (argv: Argv): Promise<string> => {
  const [w3Path, vanillaPath] = argv.positionals;
  if (w3Path === undefined || vanillaPath === undefined)
    throw new Error("compare needs two transcript paths");
  const table = renderComparison(
    loadSessionMetrics(w3Path),
    loadSessionMetrics(vanillaPath),
    await boardMetrics(argv.flags.board),
  );
  if (argv.flags.out !== undefined) writeFileSync(argv.flags.out, table, "utf8");
  return table;
};

const mock = async (argv: Argv): Promise<string> => {
  const [outDir] = argv.positionals;
  if (outDir === undefined) throw new Error("mock needs an output directory");
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const boardLog = await runAuditScenario(dir);
  const w3 = writeMockSession(dir, "whipple3-main", mockWhipple3Session());
  const vanilla = writeMockSession(dir, "vanilla-main", mockVanillaSession());
  const table = renderComparison(
    loadSessionMetrics(w3),
    loadSessionMetrics(vanilla),
    await boardMetrics(boardLog),
  );
  writeFileSync(join(dir, "comparison.md"), table, "utf8");
  console.error(`bench mock: board log ${boardLog}`);
  console.error(`bench mock: transcripts ${w3} | ${vanilla}`);
  console.error(`bench mock: comparison ${join(dir, "comparison.md")}`);
  return table;
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "compare") process.stdout.write(await compare(parseArgv(rest)));
    else if (command === "mock") process.stdout.write(await mock(parseArgv(rest)));
    else {
      console.error(USAGE);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`bench: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

void main();
