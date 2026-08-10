/** Branded IDs: an AgentId can never be passed where a NodeId is expected. (SPEC §9.2) */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type NodeId = Brand<string, "NodeId">;
export type EdgeId = Brand<string, "EdgeId">;
export type AgentId = Brand<string, "AgentId">;
export type SessionId = Brand<string, "SessionId">;
export type TxId = Brand<string, "TxId">;
export type Version = Brand<number, "Version">;

export const nodeId = (s: string): NodeId => s as NodeId;
export const edgeId = (s: string): EdgeId => s as EdgeId;
export const agentId = (s: string): AgentId => s as AgentId;
export const sessionId = (s: string): SessionId => s as SessionId;
export const txId = (s: string): TxId => s as TxId;
export const version = (n: number): Version => n as Version;

export const INITIAL_VERSION: Version = version(1);
export const bump = (v: Version): Version => version(v + 1);
