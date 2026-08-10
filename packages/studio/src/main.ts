import type { LogRecord } from "@whipple3/core";
import Graph from "graphology";
import Sigma from "sigma";
import { flashOnUpdate } from "./flash.js";
import { nodeHistory } from "./history.js";
import { assignLayout } from "./layout.js";
import { emptyModel, foldRecord, modelAt, type StudioModel } from "./model.js";
import { renderPanel } from "./panel.js";
import { syncGraph } from "./render.js";

const byId = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`studio: #${id} missing`);
  return found;
};
const container = byId("graph");
const statusEl = byId("status");
const panelEl = byId("panel");
// byId returns HTMLElement; index.html declares these exact controls
const scrubEl = byId("scrub") as HTMLInputElement;
const liveBtn = byId("live") as HTMLButtonElement;

const graph = new Graph();
// allowInvalidContainer: module code may run before first layout gives #graph a width;
// Sigma observes resizes and recovers the moment the container has real dimensions.
const sigma = new Sigma(graph, container, { allowInvalidContainer: true });

const records: LogRecord[] = [];
let model: StudioModel = emptyModel();
let mode: "live" | "paused" = "live";
let position = -1; // index of the last record folded into `model`
let selected: string | null = null;
let session = "?";

const renderStatus = (): void => {
  const where = mode === "live" ? "LIVE" : `PAUSED @ ${position + 1}/${records.length}`;
  statusEl.textContent =
    `whipple3 studio — session ${session} · ${records.length} records · ` +
    `${graph.order} nodes · ${graph.size} edges · ${where}`;
};

const refresh = (): void => {
  syncGraph(graph, model);
  assignLayout(graph);
  renderPanel(
    panelEl,
    model,
    selected,
    selected === null ? [] : nodeHistory(records, selected, position),
  );
  scrubEl.max = String(Math.max(records.length - 1, 0));
  if (mode === "live") scrubEl.value = String(position);
  liveBtn.disabled = mode === "live";
  liveBtn.textContent = mode === "live" ? "live" : "go live";
  renderStatus();
};

// restore reads `model` at fire time on purpose: whatever the board looks like
// when the pulse ends is what the node size falls back to.
const flashRecord = (record: LogRecord): void => {
  flashOnUpdate(
    graph,
    record,
    () => syncGraph(graph, model),
    (fn, ms) => window.setTimeout(fn, ms),
  );
};

sigma.on("clickNode", ({ node }) => {
  selected = node;
  refresh();
});
sigma.on("clickStage", () => {
  selected = null;
  refresh();
});

scrubEl.addEventListener("input", () => {
  mode = "paused";
  position = Number(scrubEl.value);
  model = modelAt(records, position);
  refresh();
});

liveBtn.addEventListener("click", () => {
  mode = "live";
  position = records.length - 1;
  model = modelAt(records, position);
  refresh();
});

const source = new EventSource("/events");
source.addEventListener("record", (evt: Event) => {
  // lib.dom types custom EventSource events as bare Event; the SSE contract
  // (sse.ts, covered by test/sse.test.ts) guarantees a MessageEvent with data.
  const data = (evt as MessageEvent<string>).data;
  // Trusted boundary: our own same-origin server emits records it read from the
  // session log; zod is not an approved studio dependency, so no runtime parse.
  const record = JSON.parse(data) as LogRecord;
  if (record.seq < records.length) return; // EventSource reconnects replay from seq 0
  records.push(record);
  session = record.meta.sessionId;
  if (mode === "live") {
    model = foldRecord(model, record);
    position = records.length - 1;
    refresh();
    flashRecord(record);
  } else {
    refresh(); // grows the scrubber range; the paused snapshot stays put
  }
});
source.onerror = () => {
  statusEl.textContent = "whipple3 studio — stream disconnected, retrying…";
};
