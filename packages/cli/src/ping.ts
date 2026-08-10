import { agentId } from "@whipple3/core";
import { connectBoard } from "@whipple3/transport-uds";
import { defineCommand } from "citty";

/**
 * The honest preflight: a socket FILE proves a listener existed once; only a real
 * connect + status round-trip proves one exists now. (found by the first live /audit)
 */
export const ping = defineCommand({
  meta: { name: "ping", description: "Probe a board: connect, hello, status round-trip." },
  args: {
    board: {
      type: "string",
      description: "Socket path of the board to probe.",
      default: ".whipple3/board.sock",
    },
  },
  async run({ args }) {
    try {
      const board = await connectBoard({ socketPath: args.board, agentId: agentId("ping") });
      const s = await board.status();
      board.close();
      console.log(
        `whipple3 ping: board live at ${args.board} — ${s.nodes} nodes, ${s.activeClaims} active claims`,
      );
    } catch (e) {
      console.error(`whipple3 ping: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  },
});
