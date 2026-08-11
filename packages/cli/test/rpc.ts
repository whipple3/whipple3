import type { ChildProcessWithoutNullStreams } from "node:child_process";

// Test edge: we trust the server's JSON-RPC framing and probe the fields we assert on.
export interface RpcReply {
  readonly id?: number;
  readonly result?: {
    readonly serverInfo?: { readonly name: string };
    readonly content?: readonly { readonly text: string }[];
  };
}

/** Line-framed JSON-RPC over a child's stdio — the one client both e2e suites share. */
export const rpcClient = (child: ChildProcessWithoutNullStreams) => {
  const pending = new Map<number, (reply: RpcReply) => void>();
  child.on("exit", (code) => {
    for (const resolve of pending.values())
      resolve({ result: { serverInfo: { name: `process exited early (code ${String(code)})` } } });
  });
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let cut = buffer.indexOf("\n");
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line !== "") {
        const reply = JSON.parse(line) as RpcReply;
        if (reply.id !== undefined) pending.get(reply.id)?.(reply);
      }
      cut = buffer.indexOf("\n");
    }
  });

  let nextId = 0;
  const send = (message: Record<string, unknown>) =>
    child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method: string, params: Record<string, unknown>): Promise<RpcReply> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
      send({ jsonrpc: "2.0", id, method, params });
    });
  };
  return {
    request,
    notify: (method: string) => send({ jsonrpc: "2.0", method }),
    initialize: async (): Promise<void> => {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "0.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
    },
    call: async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const reply = await request("tools/call", { name, arguments: args });
      const text = reply.result?.content?.[0]?.text;
      if (text === undefined)
        throw new Error(`tool ${name} answered without content: ${JSON.stringify(reply)}`);
      return JSON.parse(text);
    },
  };
};
