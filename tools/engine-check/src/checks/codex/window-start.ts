import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { CheckSkipped, type Check } from "../../check.ts";
import type { CodexSession } from "../../codex/codex-session.ts";
import { CODEX_CHECK_EFFORT, CODEX_CHECK_MODEL } from "../../codex/options.ts";
import type {
  GetAccountRateLimitsResponse,
  RateLimitWindow,
  ThreadOpenedResponse,
} from "../../codex/protocol.ts";
import { filesUnder, newFiles, processRunning } from "../observations.ts";
import { turnEnding } from "./observations.ts";

/** Where Codex keeps a thread's rollout, live and archived, under the account folder. */
const THREAD_FOLDERS = ["sessions", "archived_sessions"] as const;
/** The start's prompt, kept as the service's `WINDOW_START_PROMPT`. */
const WINDOW_START_PROMPT = "Reply with OK.";
const FIVE_HOURS_MINUTES = 5 * 60;
const FIVE_HOURS_MS = FIVE_HOURS_MINUTES * 60 * 1000;
/** How far from 5 hours after the start a window that opened then may reset. */
const OPENED_SLACK_MS = 15 * 60 * 1000;

/**
 * The Office starting a Codex engine's 5-hour window by itself (spec §5.4.6,
 * `AgentEngine.startUsageWindow`), as the Codex adapter does: an app-server started for it alone
 * on the account folder, `thread/start` with `ephemeral: true` on `gpt-6-luna` in the read-only
 * sandbox of an empty folder, no approval asked and no MCP server, one `turn/start` (effort `low`)
 * of a one-line prompt, then the app-server closed. Skipped while the 5-hour window already runs,
 * or when the account has none (ChatGPT Free).
 */
export const codexWindowStartCheck: Check = {
  id: "codex.window-start",
  title:
    "one turn on an ephemeral thread of an app-server started for it alone starts the 5-hour window, leaves no thread file and ends its process",
  async run({ sandbox, startCodexSession }) {
    const folder = await mkdtemp(join(sandbox.root, "window-start-"));
    const spec = { repository: folder, sandbox: "read-only", approvalPolicy: "never" } as const;
    const session = await startCodexSession(spec);
    const window = await fiveHourWindow(session);
    if (window === undefined) {
      throw new CheckSkipped("The account has no 5-hour window, as on ChatGPT Free.");
    }
    if (window.resetsAt !== null && window.resetsAt * 1000 > Date.now()) {
      throw new CheckSkipped(
        `The 5-hour window already runs, until ${new Date(window.resetsAt * 1000).toISOString()}; run it again once it has reset.`,
      );
    }
    const threadFiles = async () => {
      const files = await Promise.all(
        THREAD_FOLDERS.map((name) => filesUnder(join(session.codexHome, name))),
      );
      return new Set(files.flatMap((set) => [...set]));
    };
    const before = await threadFiles();
    const startedAt = Date.now();
    const opened = (await session.request("thread/start", {
      cwd: folder,
      model: CODEX_CHECK_MODEL,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    })) as ThreadOpenedResponse;
    await session.request("turn/start", {
      threadId: opened.thread.id,
      input: [{ type: "text", text: WINDOW_START_PROMPT, text_elements: [] }],
      effort: CODEX_CHECK_EFFORT,
    });
    const turn = await session.nextTurnEnd();
    const tokens = session.tokens();
    const { processId } = session;
    await session.close();
    const processEnded = processId !== undefined && !processRunning(processId);
    const newThreadFiles = newFiles(before, await threadFiles());
    const after = await fiveHourWindow(await startCodexSession(spec));
    return {
      turnEnded: turnEnding(turn),
      windowOpened:
        after?.resetsAt !== null &&
        after?.resetsAt !== undefined &&
        Math.abs(after.resetsAt * 1000 - (startedAt + FIVE_HOURS_MS)) <= OPENED_SLACK_MS,
      newThreadFiles,
      processEnded,
      tokensCounted: {
        input: tokens.input + tokens.cacheRead + tokens.cacheCreation > 0,
        output: tokens.output > 0,
      },
    };
  },
};

/** The account's 5-hour window, by its length in either slot; undefined when it has none. */
async function fiveHourWindow(session: CodexSession): Promise<RateLimitWindow | undefined> {
  const { rateLimits } = (await session.request(
    "account/rateLimits/read",
  )) as GetAccountRateLimitsResponse;
  return [rateLimits.primary, rateLimits.secondary].find(
    (window): window is RateLimitWindow => window?.windowDurationMins === FIVE_HOURS_MINUTES,
  );
}
