import { existsSync } from "node:fs";
import {
  type AgentId,
  emptyState,
  replay as fold,
  type LogRecord,
  type Mutation,
  type NodeId,
} from "@whipple3/core";
import { createJsonlLog } from "@whipple3/log";
import { defineCommand } from "citty";

interface Verdict {
  readonly records: number;
  readonly nodes: number;
  readonly edges: number;
  readonly heldAtEnd: number;
  readonly violations: readonly string[];
}

/** A well-formed log is contiguous from 0: a gap or repeat means a torn or spliced write. */
const seqBreak = (records: readonly LogRecord[]): string | null => {
  for (const [i, record] of records.entries())
    if (record.seq !== i) return `seq is not contiguous: record ${i} carries seq ${record.seq}`;
  return null;
};

/**
 * The README's headline claim, checked rather than asserted: a node held by a LIVE claim
 * must not be taken by another agent. Renewing your own claim, and taking over one whose
 * lease has expired, are both legal — the reducer allows exactly these.
 *
 * Driven by `graph.mutation`, not by the `claim.*` taxonomy: only the mutation carries
 * `now` and `ttlMs`, and `claim.expired` is never emitted (no clock owns it until the push
 * scheduler does — transport-mcp/src/connection.ts). Reading the taxonomy instead would
 * report every legitimate lease takeover as a collision.
 *
 * This restates `apply`'s ALREADY_CLAIMED rule over the log, so it cannot fire on a log a
 * correct writer produced. That is the point: it validates the artifact independently of
 * who wrote it — a spliced log, a future scheduler, another implementation.
 */
const duplicateClaims = (mutations: readonly Mutation[]): readonly string[] => {
  const held = new Map<NodeId, { agentId: AgentId; expiresAt: number }>();
  const violations: string[] = [];
  for (const m of mutations) {
    if (m.kind === "CLAIM_NODE") {
      const live = held.get(m.id);
      if (live !== undefined && live.expiresAt > m.now && live.agentId !== m.agentId)
        violations.push(`duplicate claim on ${m.id}: ${m.agentId} over live ${live.agentId}`);
      held.set(m.id, { agentId: m.agentId, expiresAt: m.now + m.ttlMs });
    } else if (m.kind === "RELEASE_NODE") {
      held.delete(m.id);
    }
  }
  return violations;
};

const check = (records: readonly LogRecord[]): Verdict => {
  const mutations: Mutation[] = [];
  for (const { event } of records)
    if (event.type === "graph.mutation") mutations.push(event.mutation);

  // The session shell only appends what already applied, so a rejection here is not a
  // policy decision replayed — it is the log failing to reproduce its own history.
  const { state, rejected } = fold(mutations, emptyState());
  const broken = seqBreak(records);

  return {
    records: records.length,
    nodes: state.nodes.size,
    edges: state.edges.size,
    heldAtEnd: state.claims.size,
    violations: [
      ...(broken === null ? [] : [broken]),
      ...rejected.map((e) => `mutation rejected on replay: ${e.code}`),
      ...duplicateClaims(mutations),
    ],
  };
};

/**
 * Rung 2 of the install ladder (docs/positioning.md §4): the log replayed in CI, so a
 * coordination regression fails the build instead of waiting for a human to notice.
 * Deliberately schema-free — asserting over typed trajectories is Stage 7, not this.
 */
export const replay = defineCommand({
  meta: {
    name: "replay",
    description: "Re-fold a session log and verify it reproduces itself. Exits 1 on a violation.",
  },
  args: {
    log: { type: "positional", description: "Path to a session .ndjson log", required: true },
    json: { type: "boolean", default: false, description: "Emit the verdict as JSON for CI." },
  },
  async run({ args }) {
    if (!existsSync(args.log)) {
      console.error(`whipple3 replay: no such log: ${args.log}`);
      process.exitCode = 1;
      return;
    }
    const verdict = check(await createJsonlLog(args.log).read());

    if (args.json) console.log(JSON.stringify({ ...verdict, ok: verdict.violations.length === 0 }));
    else {
      const head =
        verdict.violations.length === 0 ? "OK" : `${verdict.violations.length} VIOLATION`;
      console.log(`whipple3 replay: ${verdict.records} records folded — ${head}`);
      console.log(
        `  nodes ${verdict.nodes} · edges ${verdict.edges} · claims held at end ${verdict.heldAtEnd}`,
      );
      for (const v of verdict.violations) console.error(`  ✗ ${v}`);
    }
    if (verdict.violations.length > 0) process.exitCode = 1;
  },
});
