import {
  agentId,
  type EventMeta,
  type LogRecord,
  nodeId,
  sessionId,
  txId,
  type Whipple3Event,
} from "@whipple3/core";

export const testMeta = (n: number): EventMeta => ({
  txId: txId(`tx-${n}`),
  sessionId: sessionId("s1"),
  agentId: agentId("writer"),
  principal: null,
  ts: n,
  causationId: null,
  correlationId: txId("corr"),
});

export const addNodeEvent = (n: number): Whipple3Event => ({
  type: "graph.mutation",
  mutation: { kind: "ADD_NODE", id: nodeId(`n${n}`), label: "file", props: {} },
});

export const recordOf = (seq: number, event: Whipple3Event): LogRecord => ({
  seq,
  meta: testMeta(seq),
  event,
});
