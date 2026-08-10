/**
 * UDS shared-state transport (ADR-005 amendment, ruling D1): one `whipple3 serve`
 * process owns the session; each client socket binds ONE agent identity at its hello
 * frame — ADR-007's identity-from-connection, at the socket layer.
 */
export type { ConnectBoardOptions, RemoteAgentConnection } from "./client.js";
export { connectBoard } from "./client.js";
export type { ClientFrame, Op, ReqFrame, ServerFrame } from "./frames.js";
export {
  clientFrame,
  createLineBuffer,
  encodeFrame,
  OPS,
  PROTOCOL_VERSION,
  serverFrame,
} from "./frames.js";
export type { BoardServer, BoardServerOptions } from "./server.js";
export { startBoardServer } from "./server.js";
