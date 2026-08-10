import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentId, sessionId, txId } from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { createSession } from "@whipple3/transport-mcp";
import { describe, expect, it } from "vitest";
import { connectBoard } from "../src/client.js";
import { startBoardServer } from "../src/server.js";

const makeSession = () => {
  let n = 0;
  return createSession({
    log: createMemoryLog(),
    acl: null,
    sessionId: sessionId("s1"),
    principal: null,
    now: () => 0,
    newTxId: () => txId(`tx${n++}`),
  });
};

// Found by the live run: a deep path binds fine RELATIVE but every absolute-path
// client gets ENOTSOCK after kernel truncation. Guard at both ends, loudly.
describe("UDS sun_path budget — refuse loudly, never truncate silently", () => {
  const longPath = join(mkdtempSync(join(tmpdir(), "w3sun-")), "x".repeat(120), "board.sock");

  it("the server refuses a socket path that resolves past the budget", async () => {
    await expect(
      startBoardServer({ session: makeSession(), socketPath: longPath }),
    ).rejects.toThrow(/sun_path|shorter path/);
  });

  it("the client refuses the same path before dialing", async () => {
    await expect(connectBoard({ socketPath: longPath, agentId: agentId("a") })).rejects.toThrow(
      /sun_path|shorter path/,
    );
  });

  it("dialing a missing socket says 'is whipple3 serve running', not just ENOENT", async () => {
    const missing = join(mkdtempSync(join(tmpdir(), "w3sun-")), "none.sock");
    await expect(connectBoard({ socketPath: missing, agentId: agentId("a") })).rejects.toThrow(
      /whipple3 serve/,
    );
  });

  it("dialing a regular file explains ENOTSOCK instead of leaking it", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "w3sun-")), "board.sock");
    writeFileSync(file, "not a socket");
    await expect(connectBoard({ socketPath: file, agentId: agentId("a") })).rejects.toThrow(
      /not a socket|stray file/,
    );
  });
});
