import type { Check } from "../../check.ts";
import type {
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
  ThreadTokenUsageUpdatedNotification,
} from "../../codex/protocol.ts";
import { sortedNames } from "../observations.ts";
import { snapshotShape, turnEnding } from "./observations.ts";

/**
 * Usage windows and token counts on the Codex engine (spec §2.10, §5.4, the `usageWindows` and
 * `contextUsage` capabilities): `account/rateLimits/read` before and after one turn,
 * `account/rateLimits/updated` during it, `thread/tokenUsage/updated`'s fields, and how a turn is
 * marked when a used-up window refuses it, which shows only while one is used up.
 */
export const codexUsageReadingCheck: Check = {
  id: "codex.usage-reading",
  title:
    "account/rateLimits/read reads the usage windows, and a turn reports its tokens and context",
  async run({ sandbox, startCodexSession }) {
    const session = await startCodexSession({ repository: await sandbox.createRepository() });
    const before = (await session.request(
      "account/rateLimits/read",
    )) as GetAccountRateLimitsResponse;
    await session.startThread();
    await session.startTurn("Reply with just OK.");
    const turn = await session.nextTurnEnd();
    const after = (await session.request(
      "account/rateLimits/read",
    )) as GetAccountRateLimitsResponse;
    const updates = session.messages
      .filter((message) => message.method === "account/rateLimits/updated")
      .map((message) => (message.params as { rateLimits: RateLimitSnapshot }).rateLimits);
    const tokenUpdates = session.messages
      .filter((message) => message.method === "thread/tokenUsage/updated")
      .map((message) => message.params as ThreadTokenUsageUpdatedNotification);
    const usedUp = before.rateLimits.rateLimitReachedType !== null;
    return {
      turnEnded: usedUp ? "a window was used up" : turnEnding(turn),
      before: snapshotShape(before.rateLimits),
      after: snapshotShape(after.rateLimits),
      limitIds: sortedNames(Object.keys(after.rateLimitsByLimitId ?? {})),
      updatedDuringTurn: updates.length > 0,
      updateShape: updates.length === 0 ? null : snapshotShape(updates[updates.length - 1]!),
      tokenUsage: {
        updates: tokenUpdates.length > 0,
        fields: sortedNames(Object.keys(tokenUpdates[0]?.tokenUsage.last ?? {})),
        contextWindowGiven: tokenUpdates.some(
          (update) => typeof update.tokenUsage.modelContextWindow === "number",
        ),
      },
      ...(usedUp ? { refusedTurn: turnEnding(turn) } : {}),
    };
  },
};
