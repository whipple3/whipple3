import {
  type AclPolicy,
  agentId,
  principal,
  type SliceDecl,
  sessionId,
  txId,
} from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { createSession } from "../src/session.js";

/**
 * The one session harness every suite shares: deterministic time via tick, sequential
 * tx ids, a memory log, optional ACL + role slices. Suites that need a special log or
 * lifetime still call createSession directly.
 */
export const makeSession = (
  acl: AclPolicy | null = null,
  slices: Readonly<Record<string, SliceDecl>> | undefined = undefined,
) => {
  let now = 0;
  let n = 0;
  const log = createMemoryLog();
  const session = createSession({
    log,
    acl,
    slices,
    sessionId: sessionId("s1"),
    principal: principal("michael"),
    now: () => now,
    newTxId: () => txId(`tx${n++}`),
  });
  const as = (id: string) => session.connect(agentId(id));
  return { session, as, log, tick: (ms: number) => (now += ms) };
};
