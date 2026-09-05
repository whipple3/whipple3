import { z } from "zod";

/**
 * Claude Code session transcripts (~/.claude/projects/<proj>/<session>.jsonl), format
 * verified against a real 2026-08 session. Facts the extractor depends on:
 * - one JSON object per line; record types beyond user/assistant/system exist and new
 *   ones appear over time — unknown types are DATA, never errors;
 * - main-thread message lines carry `isSidechain: false`; subagent sidechains are
 *   separate files in the current format (`<session>/subagents/agent-*.jsonl`,
 *   `isSidechain: true`) and INLINE in the main file in older sessions — the flag is
 *   the discriminator either way;
 * - ONE API response is written as one line per content block, all sharing `requestId`,
 *   each carrying a cumulative usage snapshot (output_tokens grows across the lines);
 * - synthetic lines (API errors) have no requestId/usage — tokens are never estimated.
 */
export interface Usage {
  readonly input: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly output: number;
}

export interface AssistantRecord {
  readonly kind: "assistant";
  readonly sidechain: boolean;
  readonly timestamp: number | null;
  readonly requestId: string | null;
  readonly usage: Usage | null;
  /** Tool name when this line's single content block is a tool_use. */
  readonly toolUse: string | null;
  /** That block's raw `input`. Foreign and per-tool: `unknown` on purpose, parse at use. */
  readonly toolInput: unknown;
}

export interface OtherRecord {
  readonly kind: "user" | "system" | "other";
  readonly sidechain: boolean;
  readonly timestamp: number | null;
  readonly type: string;
}

export type TranscriptRecord = AssistantRecord | OtherRecord;

export interface Transcript {
  readonly records: readonly TranscriptRecord[];
  readonly malformed: number;
}

const usageSchema = z.looseObject({
  input_tokens: z.number(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  output_tokens: z.number(),
});

const lineSchema = z.looseObject({
  type: z.string(),
  isSidechain: z.boolean().optional(),
  timestamp: z.string().optional(),
  requestId: z.string().optional(),
  message: z
    .looseObject({
      content: z.unknown().optional(),
      usage: usageSchema.optional(),
    })
    .optional(),
});

const contentBlockSchema = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  // Foreign, per-tool, and unversioned — kept as `unknown` and never interpreted here.
  // Consumers that need a field parse it themselves at their own boundary.
  input: z.unknown().optional(),
});

const parseTimestamp = (iso: string | undefined): number | null => {
  if (iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

const toUsage = (u: z.output<typeof usageSchema> | undefined): Usage | null =>
  u === undefined
    ? null
    : {
        input: u.input_tokens,
        cacheCreation: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens,
      };

const toolUse = (content: unknown): { name: string | null; input: unknown } => {
  if (!Array.isArray(content)) return { name: null, input: undefined };
  for (const raw of content) {
    const block = contentBlockSchema.safeParse(raw);
    if (block.success && block.data.type === "tool_use")
      return { name: block.data.name ?? null, input: block.data.input };
  }
  return { name: null, input: undefined };
};

const toRecord = (line: z.output<typeof lineSchema>): TranscriptRecord => {
  const sidechain = line.isSidechain === true;
  const timestamp = parseTimestamp(line.timestamp);
  if (line.type === "assistant") {
    const tool = toolUse(line.message?.content);
    return {
      kind: "assistant",
      sidechain,
      timestamp,
      requestId: line.requestId ?? null,
      usage: toUsage(line.message?.usage),
      toolUse: tool.name,
      toolInput: tool.input,
    };
  }
  const kind = line.type === "user" || line.type === "system" ? line.type : "other";
  return { kind, sidechain, timestamp, type: line.type };
};

export const parseTranscript = (text: string): Transcript => {
  const records: TranscriptRecord[] = [];
  let malformed = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    const parsed = lineSchema.safeParse(json);
    if (parsed.success) records.push(toRecord(parsed.data));
    else malformed += 1;
  }
  return { records, malformed };
};
