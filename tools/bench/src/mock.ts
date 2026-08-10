import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Synthetic-but-format-true transcript pair for the pipeline proof: every quirk the
 * extractor must survive is reproduced — one line per content block, shared requestId,
 * cumulative usage snapshots, sidecar subagent files. Numbers are FIXED so the mock
 * comparison is exact and asserted in tests; they prove the instrument, not the product.
 */
export interface MockSession {
  readonly main: string;
  readonly subagents: readonly { readonly file: string; readonly text: string }[];
}

interface MockUsage {
  readonly input: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly output: number;
}

type Block =
  | { readonly type: "thinking" }
  | { readonly type: "text" }
  | { readonly type: "tool_use"; readonly name: string };

interface MockRequest {
  readonly requestId: string;
  readonly ts: string;
  readonly usage: MockUsage;
  readonly blocks: readonly Block[];
  readonly sidechain?: boolean;
}

const contentOf = (block: Block, i: number): Record<string, unknown> => {
  if (block.type === "thinking") return { type: "thinking", thinking: "…" };
  if (block.type === "text") return { type: "text", text: "…" };
  return { type: "tool_use", id: `toolu_${i}`, name: block.name, input: {} };
};

/** One API response = one line per block; usage snapshots grow to the final total. */
const assistantLines = (r: MockRequest): readonly string[] =>
  r.blocks.map((block, i) =>
    JSON.stringify({
      type: "assistant",
      isSidechain: r.sidechain ?? false,
      uuid: `${r.requestId}-${i}`,
      timestamp: r.ts,
      requestId: r.requestId,
      message: {
        role: "assistant",
        model: "mock-no-llm",
        content: [contentOf(block, i)],
        usage: {
          input_tokens: r.usage.input,
          cache_creation_input_tokens: r.usage.cacheCreation,
          cache_read_input_tokens: r.usage.cacheRead,
          output_tokens: Math.round((r.usage.output * (i + 1)) / r.blocks.length),
        },
      },
    }),
  );

const userLine = (ts: string, text: string, uuid: string): string =>
  JSON.stringify({
    type: "user",
    isSidechain: false,
    uuid,
    timestamp: ts,
    message: { role: "user", content: text },
  });

const usage = (
  input: number,
  cacheCreation: number,
  cacheRead: number,
  output: number,
): MockUsage => ({ input, cacheCreation, cacheRead, output }) as const;

const T = (hms: string): string => `2026-08-11T${hms}.000Z`;

const jsonl = (lines: readonly string[]): string => `${lines.join("\n")}\n`;

const sidecar = (agent: string, reqA: MockUsage, reqB: MockUsage): string =>
  jsonl([
    ...assistantLines({
      requestId: `req_${agent}_a`,
      ts: T("10:01:00"),
      usage: reqA,
      blocks: [{ type: "thinking" }, { type: "text" }],
      sidechain: true,
    }),
    ...assistantLines({
      requestId: `req_${agent}_b`,
      ts: T("10:03:00"),
      usage: reqB,
      blocks: [{ type: "text" }],
      sidechain: true,
    }),
  ]);

const sidecars = (prefix: string, reqA: MockUsage, reqB: MockUsage): MockSession["subagents"] =>
  [1, 2, 3].map((n) => ({
    file: `agent-${prefix}${n}.jsonl`,
    text: sidecar(`${prefix}${n}`, reqA, reqB),
  }));

/** Orchestrator coordinates; findings live on the board — main thread stays lean. */
export const mockWhipple3Session = (): MockSession => ({
  main: jsonl([
    userLine(T("10:00:00"), "/whipple3:audit src/", "u1"),
    ...assistantLines({
      requestId: "req_w1",
      ts: T("10:00:10"),
      usage: usage(4, 12_000, 0, 400),
      blocks: [
        { type: "thinking" },
        { type: "text" },
        { type: "tool_use", name: "Task" },
        { type: "tool_use", name: "Task" },
        { type: "tool_use", name: "Task" },
      ],
    }),
    userLine(T("10:04:00"), "auditor-1 done: findings on the board", "u2"),
    userLine(T("10:04:00"), "auditor-2 done: findings on the board", "u3"),
    userLine(T("10:04:00"), "auditor-3 done: findings on the board", "u4"),
    ...assistantLines({
      requestId: "req_w2",
      ts: T("10:05:00"),
      usage: usage(6, 800, 12_000, 150),
      blocks: [{ type: "tool_use", name: "Bash" }],
    }),
    userLine(T("10:05:30"), "distill wrote report.md", "u5"),
    ...assistantLines({
      requestId: "req_w3",
      ts: T("10:06:00"),
      usage: usage(2, 200, 12_800, 300),
      blocks: [{ type: "text" }],
    }),
  ]),
  subagents: sidecars("w3a", usage(500, 1_500, 8_000, 200), usage(500, 0, 9_500, 300)),
});

/** Everything funnels through the parent: each subagent report re-enters main context. */
export const mockVanillaSession = (): MockSession => ({
  main: jsonl([
    userLine(T("10:00:00"), "audit src/ with three subagents", "u1"),
    ...assistantLines({
      requestId: "req_v1",
      ts: T("10:00:10"),
      usage: usage(4, 12_000, 0, 380),
      blocks: [
        { type: "text" },
        { type: "tool_use", name: "Task" },
        { type: "tool_use", name: "Task" },
        { type: "tool_use", name: "Task" },
      ],
    }),
    userLine(T("10:02:00"), "auditor-1 full report … (fat tool_result)", "u2"),
    ...assistantLines({
      requestId: "req_v2",
      ts: T("10:02:30"),
      usage: usage(9_000, 3_000, 12_000, 700),
      blocks: [{ type: "text" }],
    }),
    userLine(T("10:03:00"), "auditor-2 full report … (fat tool_result)", "u3"),
    ...assistantLines({
      requestId: "req_v3",
      ts: T("10:03:30"),
      usage: usage(8_500, 500, 15_000, 650),
      blocks: [{ type: "text" }],
    }),
    userLine(T("10:04:00"), "auditor-3 full report … (fat tool_result)", "u4"),
    ...assistantLines({
      requestId: "req_v4",
      ts: T("10:05:00"),
      usage: usage(9_500, 700, 15_500, 900),
      blocks: [{ type: "text" }],
    }),
  ]),
  subagents: sidecars("van", usage(600, 1_400, 9_000, 250), usage(400, 0, 9_600, 350)),
});

/** Lays the session out exactly like ~/.claude/projects does; returns the main path. */
export const writeMockSession = (dir: string, baseName: string, s: MockSession): string => {
  const main = join(dir, `${baseName}.jsonl`);
  writeFileSync(main, s.main, "utf8");
  const subDir = join(dir, baseName, "subagents");
  mkdirSync(subDir, { recursive: true });
  for (const f of s.subagents) writeFileSync(join(subDir, f.file), f.text, "utf8");
  return main;
};
