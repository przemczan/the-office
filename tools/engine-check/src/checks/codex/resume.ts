import type { Check } from "../../check.ts";
import type { ThreadTokenUsageUpdatedNotification } from "../../codex/protocol.ts";
import { turnEnding } from "./observations.ts";

const WORD = "PELICAN";

/**
 * Resume on the Codex engine (spec §2.4, §5.4): a thread started in one app-server process, resumed
 * with `thread/resume` in a new one on the same account folder, remembers its turns, and whether its
 * input comes from the cache.
 */
export const codexResumeCheck: Check = {
  id: "codex.resume",
  title: "thread/resume in a new process continues the same thread with its turns",
  async run({ sandbox, startCodexSession }) {
    const repository = await sandbox.createRepository();
    const first = await startCodexSession({ repository });
    const opened = await first.startThread();
    await first.startTurn(`Remember the word ${WORD}. Reply with just OK.`);
    const remembered = await first.nextTurnEnd();
    await first.close();

    const second = await startCodexSession({ repository });
    const resumed = await second.resumeThread(opened.thread.id);
    const asked = await second.startTurn(
      "Which word did I ask you to remember? Reply with just the word.",
    );
    const answered = await second.nextTurnEnd();
    const usage = second.messages
      .filter((message) => message.method === "thread/tokenUsage/updated")
      .map((message) => message.params as ThreadTokenUsageUpdatedNotification)
      .filter((update) => update.turnId === asked.id);
    return {
      firstTurnEnded: turnEnding(remembered),
      sameThread: resumed.thread.id === opened.thread.id,
      resumedTurnEnded: turnEnding(answered),
      wordRemembered: second.finalMessage(asked.id)?.toUpperCase().includes(WORD) ?? false,
      inputFromCache: usage.some((update) => update.tokenUsage.last.cachedInputTokens > 0),
    };
  },
};
