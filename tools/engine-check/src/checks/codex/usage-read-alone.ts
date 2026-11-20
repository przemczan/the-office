import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { GetAccountRateLimitsResponse } from "../../codex/protocol.ts";
import { filesUnder, newFiles, processRunning, sortedNames } from "../observations.ts";
import { snapshotShape } from "./observations.ts";

/** Where Codex keeps a thread's rollout, live and archived, under the account folder. */
const THREAD_FOLDERS = ["sessions", "archived_sessions"] as const;

/**
 * The Office's engine-level read of the usage windows on the Codex engine (spec §5.4,
 * `AgentEngine.readUsageWindows`), which runs every 5 minutes while nothing runs on the engine: an
 * app-server started for it alone on the account folder, `initialize`, `account/rateLimits/read`,
 * no thread, then closed. Recorded: the snapshot's shape, which notifications came (a model call
 * would bring `thread/tokenUsage/updated`), how many thread files appeared under the folder's
 * `sessions/` and `archived_sessions/` from the app-server's start to its end, and whether its
 * process ended with the close.
 */
export const codexUsageReadAloneCheck: Check = {
  id: "codex.usage-read-alone",
  title:
    "account/rateLimits/read on an app-server started for it alone makes no model call, starts no thread and ends its process",
  async run({ sandbox, startCodexSession }) {
    const session = await startCodexSession({ repository: await sandbox.createRepository() });
    const threadFiles = async () => {
      const files = await Promise.all(
        THREAD_FOLDERS.map((folder) => filesUnder(join(session.codexHome, folder))),
      );
      return new Set(files.flatMap((set) => [...set]));
    };
    const before = await threadFiles();
    const read = (await session.request("account/rateLimits/read")) as GetAccountRateLimitsResponse;
    const { processId } = session;
    await session.close();
    return {
      snapshot: snapshotShape(read.rateLimits),
      notifications: sortedNames(session.messages.map(({ method }) => method)),
      modelCalled: session.messages.some(({ method }) => method === "thread/tokenUsage/updated"),
      threadsStarted: session.startedThreadIds.length,
      newThreadFiles: newFiles(before, await threadFiles()),
      processEnded: processId !== undefined && !processRunning(processId),
    };
  },
};
