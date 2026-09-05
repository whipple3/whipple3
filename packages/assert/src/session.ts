import { emptyState, type GraphState, type LogRecord, replay } from "@whipple3/core";
import { createJsonlLog } from "@whipple3/log";

/**
 * A finished session, ready to assert against: the final typed state, and the trace it
 * came from. Both derived from the log by the same pure reducer the board runs, so an
 * assertion can never disagree with what actually happened.
 */
export interface Session {
  readonly state: GraphState;
  readonly records: readonly LogRecord[];
}

export const sessionFrom = (records: readonly LogRecord[]): Session => {
  const mutations = records.flatMap((r) =>
    r.event.type === "graph.mutation" ? [r.event.mutation] : [],
  );
  return { state: replay(mutations, emptyState()).state, records };
};

/** Process edge: read a session log off disk and fold it. */
export const sessionFromLog = async (path: string): Promise<Session> =>
  sessionFrom(await createJsonlLog(path).read());
