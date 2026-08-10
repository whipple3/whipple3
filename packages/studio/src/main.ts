import type { LogRecord } from "@whipple3/core";
import Graph from "graphology";
import Sigma from "sigma";
import { type GraphOp, recordToOps } from "./graph-ops.js";

const NODE_SIZE = 8;
const FLASH_SIZE = 13;
const FLASH_MS = 700;
const EDGE_COLOR = "#5a6b80";

const container = document.getElementById("graph");
const statusEl = document.getElementById("status");
if (container === null || statusEl === null) throw new Error("studio: #graph or #status missing");

const graph = new Graph();
new Sigma(graph, container);

const applyOp = (op: GraphOp): void => {
  switch (op.kind) {
    case "add-node": {
      if (graph.hasNode(op.id)) return;
      graph.addNode(op.id, {
        x: op.x,
        y: op.y,
        size: NODE_SIZE,
        color: op.color,
        label: `${op.id} · ${op.label}`,
      });
      return;
    }
    case "add-edge": {
      if (graph.hasEdge(op.id) || !graph.hasNode(op.from) || !graph.hasNode(op.to)) return;
      graph.addEdgeWithKey(op.id, op.from, op.to, { label: op.label, size: 2, color: EDGE_COLOR });
      return;
    }
    case "touch-node": {
      // UPDATE_NODE hint: brief halo + size bump, then back to rest.
      if (!graph.hasNode(op.id)) return;
      graph.mergeNodeAttributes(op.id, { highlighted: true, size: FLASH_SIZE });
      window.setTimeout(() => {
        if (!graph.hasNode(op.id)) return;
        graph.mergeNodeAttributes(op.id, { highlighted: false, size: NODE_SIZE });
      }, FLASH_MS);
      return;
    }
  }
};

let nextSeq = 0;
let records = 0;
let session = "?";

const renderStatus = (): void => {
  statusEl.textContent =
    `whipple3 studio — session ${session} · ${records} records · ` +
    `${graph.order} nodes · ${graph.size} edges`;
};

const source = new EventSource("/events");
source.addEventListener("record", (evt: Event) => {
  // lib.dom types custom EventSource events as bare Event; the SSE contract
  // (sse.ts, covered by test/sse.test.ts) guarantees a MessageEvent with data.
  const data = (evt as MessageEvent<string>).data;
  // Trusted boundary: our own same-origin server emits records it read from the
  // session log; zod is not an approved studio dependency, so no runtime parse.
  const record = JSON.parse(data) as LogRecord;
  if (record.seq < nextSeq) return; // EventSource reconnects replay from seq 0
  nextSeq = record.seq + 1;
  records += 1;
  session = record.meta.sessionId;
  for (const op of recordToOps(record)) applyOp(op);
  renderStatus();
});
source.onerror = () => {
  statusEl.textContent = "whipple3 studio — stream disconnected, retrying…";
};
