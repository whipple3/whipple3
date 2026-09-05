import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { parseTranscript, type Transcript } from "./transcript.js";

/**
 * Imperative shell for Claude Code's on-disk session layout:
 *   ~/.claude/projects/<project>/<session>.jsonl          main thread
 *   ~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl  + .meta.json
 *
 * Everything here is READ-ONLY and stays on the machine. Nothing is uploaded, ever —
 * these are the developer's own prompts and outputs.
 */
export interface AgentTranscript {
  readonly name: string;
  readonly kind: "main" | "subagent";
  readonly transcript: Transcript;
}

const metaSchema = z.looseObject({ agentType: z.string().optional() });

/** `agent-X.jsonl` → `agent-X.meta.json`; missing or malformed is just null. */
const metaAgentType = (jsonlPath: string): string | null => {
  const metaPath = jsonlPath.replace(/\.jsonl$/, ".meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = metaSchema.safeParse(JSON.parse(readFileSync(metaPath, "utf8")));
    return parsed.success ? (parsed.data.agentType ?? null) : null;
  } catch {
    return null;
  }
};

/**
 * Recursive on purpose. Claude Code writes sidecars in at least two shapes:
 *   subagents/agent-*.jsonl                      Task subagents
 *   subagents/workflows/wf_<id>/agent-*.jsonl    agents spawned by a workflow run
 * A flat readdir finds the first and silently reports ZERO for the second — a real
 * session with 311 agents came back as one. Undercounting in silence is the exact
 * failure this project exists to make impossible; walk the tree.
 */
const walkAgentFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walkAgentFiles(path);
      return entry.name.startsWith("agent-") && entry.name.endsWith(".jsonl") ? [path] : [];
    })
    .sort();

const subagentFiles = (transcriptPath: string): readonly string[] => {
  const dir = join(
    dirname(transcriptPath),
    basename(transcriptPath, extname(transcriptPath)),
    "subagents",
  );
  return existsSync(dir) ? walkAgentFiles(dir) : [];
};

export const loadSession = (transcriptPath: string): readonly AgentTranscript[] => [
  {
    name: "main",
    kind: "main",
    transcript: parseTranscript(readFileSync(transcriptPath, "utf8")),
  },
  ...subagentFiles(transcriptPath).map((file, i): AgentTranscript => {
    // agentType when Claude Code recorded one; the file ordinal is the honest fallback.
    const named = metaAgentType(file) ?? basename(file, ".jsonl");
    return {
      name: `${named}-${i + 1}`,
      kind: "subagent",
      transcript: parseTranscript(readFileSync(file, "utf8")),
    };
  }),
];

const jsonlIn = (dir: string): readonly string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(dir, f))
    : [];

/** Most recently modified transcript across every project. Null when none exist. */
export const latestSession = (root = join(homedir(), ".claude", "projects")): string | null => {
  if (!existsSync(root)) return null;
  const files = readdirSync(root).flatMap((project) => jsonlIn(join(root, project)));
  let best: { path: string; mtime: number } | null = null;
  for (const path of files) {
    const mtime = statSync(path).mtimeMs;
    if (best === null || mtime > best.mtime) best = { path, mtime };
  }
  return best?.path ?? null;
};
