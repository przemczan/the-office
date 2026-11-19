import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { eventsOfType, fieldNames, indexOfType } from "../../copilot-cli/events.ts";
import { COPILOT_TOKEN_VARIABLE } from "../../copilot-cli/options.ts";
import { roundedTokens } from "../engine/requests.ts";
import { filesUnder, newFiles, sortedNames } from "../observations.ts";

async function entriesOf(folder: string): Promise<Set<string>> {
  return new Set(await readdir(folder).catch(() => []));
}

/** Whether any file under `folder` holds `text`; the text itself is never recorded. */
async function anyFileHolds(folder: string, text: string): Promise<boolean> {
  for (const file of await filesUnder(folder)) {
    if ((await readFile(file, "latin1").catch(() => "")).includes(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Sign-in on the Copilot engine: the token the client is given signs the runtime in, what the
 * runtime writes to its config folder and whether the token lands in any of it, and that the user's
 * own `~/.copilot` is left as it was.
 */
export const copilotSignInCheck: Check = {
  id: "copilot.sign-in",
  title:
    "the given token signs the runtime in, stays out of its folder, and ~/.copilot is untouched",
  async run({ sandbox, copilotHome, startCopilotSession }) {
    const userFolder = join(homedir(), ".copilot");
    const userFolderExisted = existsSync(userFolder);
    const userFilesBefore = await filesUnder(userFolder);
    const homeBefore = await entriesOf(copilotHome);
    const session = await startCopilotSession({ repository: await sandbox.createRepository() });
    const auth = await session.client.getAuthStatus();
    await session.close();
    const homeAfter = await entriesOf(copilotHome);
    // Read for the comparison alone: the check's context never carries the token.
    const token = process.env[COPILOT_TOKEN_VARIABLE] ?? "";
    return {
      authType: auth.authType ?? "none",
      authenticated: auth.isAuthenticated,
      configFolderEntries: sortedNames([...homeAfter].filter((entry) => !homeBefore.has(entry))),
      tokenInConfigFolder: token !== "" && (await anyFileHolds(copilotHome, token)),
      userFolder: {
        existedBefore: userFolderExisted,
        existsAfter: existsSync(userFolder),
        newFiles: newFiles(userFilesBefore, await filesUnder(userFolder)),
      },
    };
  },
};

/** The union of the fields of each value, sorted. */
function unionOfFields(values: readonly unknown[]): string[] {
  return sortedNames(values.flatMap((value) => fieldNames(value)));
}

/**
 * Usage on the Copilot engine: what a turn reports of its tokens and quota (`assistant.usage` and
 * its `copilotUsage`, `session.usage_info`, `session.quota_observation`), and what the session's and
 * the account's quota and usage reads answer, by their fields.
 */
export const copilotUsageCheck: Check = {
  id: "copilot.usage",
  title: "a turn reports its tokens and quota, and the quota and usage reads answer",
  async run({ sandbox, startCopilotSession }) {
    const session = await startCopilotSession({ repository: await sandbox.createRepository() });
    const events = await session.turn(
      "Run the shell command `git status --short` once, then reply with just DONE.",
    );
    const usage = eventsOfType(events, "assistant.usage").map((event) => event.data);
    const quota = await session.sdk.rpc.quota.get();
    const accountQuota = await session.client.rpc.account.getQuota({});
    const metrics = await session.sdk.rpc.usage.getMetrics();
    const tokens = session.tokens();
    return {
      assistantUsageFields: unionOfFields(usage),
      copilotUsageFields: unionOfFields(usage.map((data) => data.copilotUsage)),
      usageInfoFields: unionOfFields(
        eventsOfType(session.events, "session.usage_info").map((event) => event.data),
      ),
      quotaObservation: indexOfType(session.events, "session.quota_observation") !== -1,
      sessionQuota: {
        snapshots: sortedNames(Object.keys(quota.snapshots)),
        snapshotFields: fieldNames(Object.values(quota.snapshots)[0]),
      },
      accountQuotaSnapshots: sortedNames(Object.keys(accountQuota.quotaSnapshots)),
      metricsFields: fieldNames(metrics),
      inputTokens: roundedTokens(tokens.input),
      outputTokens: roundedTokens(tokens.output),
      inputTokensCounted: tokens.input > 0,
      outputTokensCounted: tokens.output > 0,
    };
  },
};
