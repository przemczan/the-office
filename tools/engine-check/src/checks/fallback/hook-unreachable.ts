import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { Check } from "../../check.ts";
import { observeCall } from "../permissions/call-observations.ts";
import { toolCalls, toolResultText } from "../tool-calls.ts";

const FILE = "README.md";

/**
 * The Office rules refuse when the hook can't reach the service, never allow (spec §6): the hook
 * points at a `localhost` port nothing listens on, under the `onFailure: 'block'` the fallback sets.
 */
export const fallbackHookUnreachableCheck: Check = {
  id: "fallback.hook-unreachable",
  title: "a call is refused when the hook endpoint can't be reached",
  async run({ sandbox, startClaudeCodePSession }) {
    const repository = await sandbox.createRepository();
    const session = await startClaudeCodePSession({
      repository,
      hookUrl: `http://127.0.0.1:${await freePort()}/hook`,
    });
    session.send(
      `Read ${FILE} with the Read tool, once, and do not retry a refused call. Then reply with just OK.`,
    );
    await session.nextResult();
    const reads = toolCalls(session.messages).filter((call) => call.name === "Read");
    return {
      read: observeCall(session, reads),
      fileContentReachedModel: reads.some((call) =>
        toolResultText(session.messages, call.id).includes("Engine check repository"),
      ),
    };
  },
};

/** A port that was free a moment ago, so nothing answers on it. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
