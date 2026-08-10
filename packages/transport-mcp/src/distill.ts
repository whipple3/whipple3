import {
  emptyState,
  type LogRecord,
  type Mutation,
  type MutationError,
  type NodeRecord,
  replay,
} from "@whipple3/core";

/**
 * Distillation is a fold over the log (SPEC §4.2): pure functions, no I/O, no live
 * session needed — a post-mortem over the source of truth. The graph replayed here is
 * the pre-purge board: purge discards working state, never history.
 */
export interface AgentActivity {
  readonly posts: number;
  readonly updates: number;
  readonly edges: number;
  readonly claims: number;
  readonly releases: number;
  readonly denials: number;
}

export interface SessionSummary {
  readonly sessionId: string | null;
  readonly principal: string | null;
  readonly startTs: number | null;
  readonly endTs: number | null;
  readonly records: number;
  readonly nodesByLabel: ReadonlyMap<string, readonly NodeRecord[]>;
  readonly agents: ReadonlyMap<string, AgentActivity>;
  readonly rejected: readonly MutationError[];
  readonly distilledSummary: string | null;
  readonly purged: boolean;
}

type MutableActivity = { -readonly [K in keyof AgentActivity]: AgentActivity[K] };

const blankActivity = (): MutableActivity => ({
  posts: 0,
  updates: 0,
  edges: 0,
  claims: 0,
  releases: 0,
  denials: 0,
});

const countMutation = (a: MutableActivity, m: Mutation): void => {
  switch (m.kind) {
    case "ADD_NODE":
      a.posts += 1;
      break;
    case "UPDATE_NODE":
      a.updates += 1;
      break;
    case "ADD_EDGE":
      a.edges += 1;
      break;
    case "CLAIM_NODE":
      a.claims += 1;
      break;
    case "RELEASE_NODE":
      a.releases += 1;
      break;
    default:
      m satisfies never;
  }
};

const sortByKey = <V>(entries: Iterable<readonly [string, V]>): Map<string, V> =>
  new Map([...entries].sort(([a], [b]) => a.localeCompare(b)));

const groupByLabel = (nodes: Iterable<NodeRecord>): Map<string, readonly NodeRecord[]> => {
  const groups = new Map<string, NodeRecord[]>();
  const sorted = [...nodes].sort((a, b) => (a.id as string).localeCompare(b.id as string));
  for (const n of sorted) {
    const bucket = groups.get(n.label);
    if (bucket === undefined) groups.set(n.label, [n]);
    else bucket.push(n);
  }
  return sortByKey(groups);
};

export const summarize = (records: readonly LogRecord[]): SessionSummary => {
  const mutations: Mutation[] = [];
  const agents = new Map<string, MutableActivity>();
  const activity = (id: string): MutableActivity => {
    const found = agents.get(id);
    if (found !== undefined) return found;
    const fresh = blankActivity();
    agents.set(id, fresh);
    return fresh;
  };
  let distilledSummary: string | null = null;
  let purged = false;

  for (const { meta, event } of records) {
    if (event.type === "graph.mutation") {
      mutations.push(event.mutation);
      if (meta.agentId !== null) countMutation(activity(meta.agentId), event.mutation);
    } else if (event.type === "acl.denied") activity(event.agentId).denials += 1;
    else if (event.type === "session.distilled") distilledSummary = event.summary;
    else if (event.type === "session.purged") purged = true;
  }

  const { state, rejected } = replay(mutations, emptyState());
  return {
    sessionId: records[0]?.meta.sessionId ?? null,
    principal: records[0]?.meta.principal ?? null,
    startTs: records[0]?.meta.ts ?? null,
    endTs: records.at(-1)?.meta.ts ?? null,
    records: records.length,
    nodesByLabel: groupByLabel(state.nodes.values()),
    agents: sortByKey(agents),
    rejected,
    distilledSummary,
    purged,
  };
};

const formatDuration = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${ms / 1000}s`);

const renderMeta = (s: SessionSummary): readonly string[] => [
  `- **session:** \`${s.sessionId ?? "unknown"}\``,
  `- **principal:** \`${s.principal ?? "unknown"}\``,
  ...(s.startTs !== null && s.endTs !== null
    ? [
        `- **started:** ${new Date(s.startTs).toISOString()}`,
        `- **duration:** ${formatDuration(s.endTs - s.startTs)}`,
      ]
    : []),
  `- **log records:** ${s.records}`,
  `- **replay rejected:** ${s.rejected.length}`,
  `- **purged:** ${s.purged ? "yes" : "no"}`,
  ...(s.distilledSummary === null ? [] : ["", `> ${s.distilledSummary}`]),
];

const renderFindings = (byLabel: SessionSummary["nodesByLabel"]): readonly string[] => {
  if (byLabel.size === 0) return ["_(empty board)_"];
  return [...byLabel.entries()].flatMap(([label, nodes]) => [
    `### ${label} (${nodes.length})`,
    "",
    ...nodes.map((n) => `- \`${n.id}\` v${n.version} — ${JSON.stringify(n.props)}`),
    "",
  ]);
};

const renderActivity = (agents: SessionSummary["agents"]): readonly string[] => {
  if (agents.size === 0) return ["_(no agent activity)_"];
  return [
    "| agent | posts | updates | edges | claims | releases | denials |",
    "|---|---|---|---|---|---|---|",
    ...[...agents.entries()].map(
      ([id, a]) =>
        `| ${id} | ${a.posts} | ${a.updates} | ${a.edges} | ${a.claims} | ${a.releases} | ${a.denials} |`,
    ),
  ];
};

export const renderReport = (s: SessionSummary): string =>
  [
    "# whipple3 session report",
    "",
    ...renderMeta(s),
    "",
    "## Findings by label",
    "",
    ...renderFindings(s.nodesByLabel),
    "## Agent activity",
    "",
    ...renderActivity(s.agents),
    "",
  ].join("\n");
