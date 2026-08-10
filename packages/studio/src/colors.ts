/**
 * Stable color assignment: label → node color, agent → claim tint. Hash-based so
 * colors survive reloads, reconnects and replays on any machine. The two palettes
 * are disjoint on purpose — a claim tint must never be mistaken for a label color.
 */

const LABEL_PALETTE = [
  "#4e9af1",
  "#f1a04e",
  "#5fd08a",
  "#ef6b8a",
  "#b98af1",
  "#f1d54e",
  "#4ed5d5",
  "#f1774e",
  "#8aa4f1",
  "#a4d54e",
] as const;

const AGENT_PALETTE = [
  "#ff5c5c",
  "#ffb020",
  "#2bd97c",
  "#26c2ff",
  "#d36bff",
  "#ffe600",
  "#ff7ab8",
  "#7dff6b",
] as const;

const FALLBACK_COLOR = "#8899aa";

export const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

export const colorForLabel = (label: string): string =>
  LABEL_PALETTE[fnv1a(label) % LABEL_PALETTE.length] ?? FALLBACK_COLOR;

export const colorForAgent = (agentId: string): string =>
  AGENT_PALETTE[fnv1a(agentId) % AGENT_PALETTE.length] ?? FALLBACK_COLOR;
