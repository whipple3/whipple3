import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogRecord } from "@whipple3/core";
import type { LogTail } from "./tail.js";

/**
 * Server-Sent Events over the tail: full replay on connect, then live records.
 * The client dedupes by seq, so a reconnect (EventSource auto-retries) is just
 * a cheap replay — no resume protocol needed at this scale.
 */
export const sseHandler =
  (tail: LogTail) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");

    const send = (record: LogRecord): void => {
      res.write(`id: ${record.seq}\nevent: record\ndata: ${JSON.stringify(record)}\n\n`);
    };

    for (const record of tail.records()) send(record);
    const unsubscribe = tail.subscribe(send);
    req.on("close", unsubscribe);
  };
