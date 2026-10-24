import { join } from "node:path";
import type { Check } from "../../check.ts";
import { cacheWriteLifetimes, readsEarlierPromptFromCache, requestUsages } from "./requests.ts";

/**
 * Resume by session id within the hour (spec §2.5 "Resume, cache warm"). Any session reads the shared
 * system prompt and tools from the cache, so the fact is whether the resumed request also reads the
 * earlier conversation. The earlier turn makes a tool call, as work does: after a session's only
 * request the next one re-reads just the system prompt (docs/engine-check.md).
 */
export const resumeCacheCheck: Check = {
  id: "engine.resume-cache",
  title: "resume by session id within the hour reads the earlier conversation from the cache",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const first = await startSession({ repository });
    first.send(`Use the Read tool on ${join(repository, "README.md")}, then reply with just OK.`);
    await first.nextResult();
    await first.close();

    const resumed = await startSession({ repository, resume: first.sessionId });
    resumed.send("Reply with just OK.");
    await resumed.nextResult();
    const lastBeforeResume = requestUsages(first.messages).at(-1);
    const firstAfterResume = requestUsages(resumed.messages)[0];
    return {
      cacheReadAboveZero: (firstAfterResume?.cacheRead ?? 0) > 0,
      readsEarlierConversationFromCache:
        lastBeforeResume !== undefined && firstAfterResume !== undefined && readsEarlierPromptFromCache(lastBeforeResume, firstAfterResume),
      cacheWriteLifetimes: cacheWriteLifetimes([...requestUsages(first.messages), ...requestUsages(resumed.messages)]),
    };
  },
};
