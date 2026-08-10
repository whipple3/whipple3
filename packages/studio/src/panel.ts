import { nodeId } from "@whipple3/core";
import type { HistoryEntry } from "./history.js";
import type { StudioModel } from "./model.js";

/**
 * Side panel DOM for the selected node: current props/version, holder (with the
 * honest TTL caveat — expiry has no event until the scheduler exists), and the
 * mutation history. Built with textContent only; log payloads never become HTML.
 */
const el = (tag: string, className: string, text: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

const timeOf = (ts: number): string => new Date(ts).toLocaleTimeString();

const renderCurrent = (root: HTMLElement, model: StudioModel, selected: string): void => {
  const node = model.graph.nodes.get(nodeId(selected));
  if (node === undefined) {
    root.append(el("p", "muted", "This node does not exist at this point in time."));
    return;
  }
  root.append(el("p", "kv", `label: ${node.label} · version: ${node.version}`));
  for (const [key, value] of Object.entries(node.props))
    root.append(el("p", "kv", `${key}: ${String(value)}`));

  const held = model.held.get(selected);
  if (held !== undefined) {
    root.append(el("p", "held", `held by ${held.agentId} since ${timeOf(held.since)}`));
    root.append(
      el(
        "p",
        "muted",
        "(tint clears on release; TTL expiry has no event yet — scheduler territory)",
      ),
    );
  }
};

const renderHistory = (root: HTMLElement, history: readonly HistoryEntry[]): void => {
  root.append(el("h3", "", `history (${history.length})`));
  if (history.length === 0) {
    root.append(el("p", "muted", "no records for this node at this position"));
    return;
  }
  for (const entry of history) {
    const agent = entry.agentId ?? "?";
    const detail = entry.detail === "" ? "" : ` — ${entry.detail}`;
    root.append(
      el(
        "p",
        `entry entry-${entry.kind}`,
        `#${entry.seq} ${timeOf(entry.ts)} ${agent} ${entry.kind}${detail}`,
      ),
    );
  }
};

export const renderPanel = (
  root: HTMLElement,
  model: StudioModel,
  selected: string | null,
  history: readonly HistoryEntry[],
): void => {
  root.replaceChildren();
  if (selected === null) {
    root.append(el("p", "muted", "click a node to inspect it"));
    return;
  }
  root.append(el("h2", "", selected));
  renderCurrent(root, model, selected);
  renderHistory(root, history);
};
