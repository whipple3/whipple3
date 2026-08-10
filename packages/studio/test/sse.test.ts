import { createServer, type Server } from "node:http";
import type { LogRecord } from "@whipple3/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sseHandler } from "../src/sse.js";
import type { LogTail } from "../src/tail.js";
import { addNodeEvent, recordOf } from "./fixtures.js";

const record = (seq: number): LogRecord => recordOf(seq, addNodeEvent(seq));

const stubTail = (initial: readonly LogRecord[]) => {
  const listeners = new Set<(r: LogRecord) => void>();
  const tail: LogTail = {
    records: () => initial,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => {},
  };
  return {
    tail,
    emit: (r: LogRecord) => {
      for (const l of listeners) l(r);
    },
    listenerCount: () => listeners.size,
  };
};

/** Collect SSE text until `data:` lines have appeared `count` times. */
const readDataFrames = async (
  body: ReadableStream<Uint8Array>,
  count: number,
): Promise<string[]> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while ((text.match(/^data: /gm) ?? []).length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  void reader.cancel().catch(() => {});
  return (text.match(/^data: (.*)$/gm) ?? []).map((line) => line.slice("data: ".length));
};

describe("sseHandler", () => {
  let server: Server | undefined;
  const controllers: AbortController[] = [];
  afterEach(async () => {
    for (const c of controllers.splice(0)) c.abort();
    // closeAllConnections: undici keeps aborted-SSE sockets around for its ~4s
    // keep-alive timeout; without this, every server.close() stalls the suite.
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  const serve = (tail: LogTail): Promise<string> => {
    const s = createServer(sseHandler(tail));
    server = s;
    return new Promise((resolve, reject) => {
      s.listen(0, "127.0.0.1", () => {
        const address = s.address();
        if (address === null || typeof address === "string")
          return reject(new Error("expected a TCP address"));
        resolve(`http://127.0.0.1:${address.port}/events`);
      });
    });
  };

  const connect = async (url: string): Promise<Response> => {
    const controller = new AbortController();
    controllers.push(controller);
    return fetch(url, { signal: controller.signal });
  };

  it("responds with SSE headers", async () => {
    const { tail } = stubTail([]);
    const res = await connect(await serve(tail));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("replays buffered records on connect, with seq as event id", async () => {
    const { tail } = stubTail([record(0), record(1)]);
    const res = await connect(await serve(tail));

    if (res.body === null) throw new Error("no body");
    const frames = await readDataFrames(res.body, 2);

    const parsed = frames.map((f) => JSON.parse(f) as LogRecord);
    expect(parsed.map((r) => r.seq)).toEqual([0, 1]);
    expect(parsed[0]?.event.type).toBe("graph.mutation");
  });

  it("streams records that arrive while connected", async () => {
    const stub = stubTail([]);
    const res = await connect(await serve(stub.tail));
    await vi.waitFor(() => expect(stub.listenerCount()).toBe(1));

    stub.emit(record(0));

    if (res.body === null) throw new Error("no body");
    const frames = await readDataFrames(res.body, 1);
    expect((JSON.parse(frames[0] ?? "") as LogRecord).seq).toBe(0);
  });

  it("unsubscribes from the tail when the client disconnects", async () => {
    const stub = stubTail([]);
    const url = await serve(stub.tail);
    const controller = new AbortController();
    await fetch(url, { signal: controller.signal });
    await vi.waitFor(() => expect(stub.listenerCount()).toBe(1));

    controller.abort();

    await vi.waitFor(() => expect(stub.listenerCount()).toBe(0));
  });
});
