import { join } from "node:path";
import type { Check } from "../../check.ts";
import { pathExists } from "../paths.ts";
import { callsOn, toolCalls, toolResultText } from "../tool-calls.ts";
import { observeCall } from "./call-observations.ts";
import { allowCallsWithin, decideCallsOf, toolDecision } from "./hook-decisions.ts";

/**
 * The hook allows Write before the resume and refuses it after, so a refusal shows the resumed
 * session asks its hook afresh and keeps no grant from before (the research's "Could not confirm":
 * whether permissions granted in-session survive a resume).
 */
export const hookAfterResumeCheck: Check = {
  id: "permissions.hook-after-resume",
  title: "hook decisions still apply after a resume, and an earlier hook allow is not kept",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const before = join(repository, "before.txt");
    const after = join(repository, "after.txt");
    const first = await startSession({ repository, hooks: { PreToolUse: allowCallsWithin("Write", sandbox.root) } });
    first.send(`Use the Write tool to create ${before} with the content: check. Then reply with just OK.`);
    await first.nextResult();
    await first.close();

    const reason = "Not allowed after the resume: writing files.";
    const resumed = await startSession({
      repository,
      resume: first.sessionId,
      hooks: { PreToolUse: decideCallsOf("Write", () => toolDecision("deny", reason)) },
    });
    resumed.send(`Use the Write tool to create ${after} with the content: check. Do not retry a refused call. Then reply with just OK.`);
    await resumed.nextResult();
    const afterCalls = callsOn(toolCalls(resumed.messages), "Write", after);
    return {
      beforeResume: { outcome: observeCall(first, callsOn(toolCalls(first.messages), "Write", before)).outcome, onDisk: await pathExists(before) },
      afterResume: {
        ...observeCall(resumed, afterCalls),
        reasonReachedModel: afterCalls.some((call) => toolResultText(resumed.messages, call.id).includes(reason)),
        onDisk: await pathExists(after),
      },
    };
  },
};
