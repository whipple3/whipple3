/** The only public gate of @whipple3/transcript. No deep imports. */

export type { Projection } from "./project.js";
export { projectSession } from "./project.js";
export type { AgentTranscript } from "./session.js";
export { latestSession, loadSession } from "./session.js";
export type { Lens } from "./target.js";
export { LENSES, primaryTarget } from "./target.js";
export type {
  AssistantRecord,
  OtherRecord,
  Transcript,
  TranscriptRecord,
  Usage,
} from "./transcript.js";
export { parseTranscript } from "./transcript.js";
