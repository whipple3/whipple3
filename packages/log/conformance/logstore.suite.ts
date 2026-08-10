import type { EventMeta, Whipple3Event } from "@whipple3/core";
import { agentId, principal, sessionId, txId } from "@whipple3/core";
import { describe, expect, it } from "vitest";
import type { LogStore } from "../src/port.js";

const meta = (n: number): EventMeta => ({
  txId: txId(`tx${n}`),
  sessionId: sessionId("s1"),
  agentId: agentId("a1"),
  principal: principal("p1"),
  ts: n,
  causationId: null,
  correlationId: txId("tx0"),
});

const ev: Whipple3Event = { type: "session.started", task: "conformance" };

export const runLogStoreConformance = (
  name: string,
  make: () => Promise<{ store: LogStore; cleanup: () => Promise<void> }>,
): void => {
  describe(`LogStore conformance: ${name}`, () => {
    it("append assigns increasing seq and read returns records in order", async () => {
      const { store, cleanup } = await make();
      const a = await store.append(meta(1), ev);
      const b = await store.append(meta(2), ev);
      expect(b.seq).toBeGreaterThan(a.seq);
      const all = await store.read();
      expect(all.map((r) => r.seq)).toEqual([...all.map((r) => r.seq)].sort((x, y) => x - y));
      expect(all).toHaveLength(2);
      await cleanup();
    });

    it("read(fromSeq) skips earlier records", async () => {
      const { store, cleanup } = await make();
      await store.append(meta(1), ev);
      const second = await store.append(meta(2), ev);
      const tail = await store.read(second.seq);
      expect(tail).toHaveLength(1);
      expect(tail[0]?.meta.ts).toBe(2);
      await cleanup();
    });

    it("subscribe observes appends and unsubscribe stops them", async () => {
      const { store, cleanup } = await make();
      const seen: number[] = [];
      const stop = store.subscribe((r) => seen.push(r.seq));
      await store.append(meta(1), ev);
      stop();
      await store.append(meta(2), ev);
      expect(seen).toHaveLength(1);
      await cleanup();
    });
  });
};
