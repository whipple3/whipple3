import { agentId, type Result, sessionId, type TxId, txId } from "@whipple3/core";
import { createJsonlLog } from "@whipple3/log";
import { createSession } from "@whipple3/transport-mcp";

/**
 * Dev fixture: drives a real createSession against a jsonl log so the studio
 * tail sees exactly what a `whipple3 mcp` run would write. The script IS the
 * demo (test/fixture.test.ts pins it): claims acquired and released, a hot
 * node updated three times, one claim left held on purpose — the persistent
 * tint the UI explains honestly. `stepMs` paces it for watching; tests pass 0.
 */

const FILES = [
  "src/auth.ts",
  "src/billing.ts",
  "src/api.ts",
  "src/db.ts",
  "src/ui.ts",
  "src/queue.ts",
  "src/webhooks.ts",
  "src/jobs.ts",
] as const;

const FINDINGS = [
  { file: 0, severity: "high", title: "jwt secret in repo" },
  { file: 1, severity: "medium", title: "float money math" },
  { file: 2, severity: "low", title: "missing rate limit" },
  { file: 3, severity: "high", title: "sql string concat" },
  { file: 4, severity: "low", title: "dangerouslySetInnerHTML" },
  { file: 5, severity: "medium", title: "unbounded queue growth" },
] as const;

const CLAIM_TTL_MS = 30_000;

/** Process edge: a rejected fixture step is a bug, so throwing is the right failure mode. */
const must = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) throw new Error(`fixture step rejected: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const runFixture = async (logPath: string, stepMs = 700): Promise<void> => {
  const sleep = (): Promise<void> =>
    stepMs === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, stepMs));
  let counter = 0;
  const newTxId = (): TxId => {
    counter += 1;
    return txId(`fx-${counter.toString().padStart(4, "0")}`);
  };
  const session = createSession({
    log: createJsonlLog(logPath),
    acl: null,
    sessionId: sessionId(`fixture-${new Date().toISOString().slice(11, 19)}`),
    principal: null,
    now: () => Date.now(),
    newTxId,
  });
  const scanner = session.connect(agentId("scanner"));
  const auditors = [session.connect(agentId("auditor-1")), session.connect(agentId("auditor-2"))];
  const fixer = session.connect(agentId("fixer"));

  console.log("[fixture] scanner posting files…");
  for (const [i, path] of FILES.entries()) {
    must(
      await scanner.post({
        mutation: { kind: "ADD_NODE", id: `file-${i}`, label: "file", props: { path } },
      }),
    );
    await sleep();
  }

  console.log("[fixture] auditors: claim → finding → update → release…");
  for (const [i, finding] of FINDINGS.entries()) {
    const auditor = auditors[i % auditors.length];
    if (auditor === undefined) continue;
    must(await auditor.claim({ id: `file-${finding.file}`, ttlMs: CLAIM_TTL_MS }));
    await sleep();
    must(
      await auditor.post({
        mutation: {
          kind: "ADD_NODE",
          id: `finding-${i}`,
          label: "finding",
          props: { severity: finding.severity, title: finding.title },
        },
      }),
    );
    must(
      await auditor.post({
        mutation: {
          kind: "ADD_EDGE",
          id: `edge-${i}`,
          label: "found_in",
          from: `finding-${i}`,
          to: `file-${finding.file}`,
        },
      }),
    );
    await sleep();
    must(
      await auditor.post({
        mutation: {
          kind: "UPDATE_NODE",
          id: `file-${finding.file}`,
          expectedVersion: 1,
          props: { status: "audited" },
        },
      }),
    );
    must(await auditor.release({ id: `file-${finding.file}` }));
    await sleep();
  }

  console.log("[fixture] fixer working the hot node (claim stays held)…");
  must(await fixer.claim({ id: "file-0", ttlMs: CLAIM_TTL_MS }));
  await sleep();
  must(
    await fixer.post({
      mutation: {
        kind: "UPDATE_NODE",
        id: "file-0",
        expectedVersion: 2,
        props: { status: "fix-queued" },
      },
    }),
  );
  await sleep();
  must(
    await fixer.post({
      mutation: {
        kind: "UPDATE_NODE",
        id: "file-0",
        expectedVersion: 3,
        props: { status: "fix-applied" },
      },
    }),
  );
  // deliberately no release: the demo ends with fixer's tint still on file-0

  console.log("[fixture] done — %d records written to %s", counter, logPath);
};
