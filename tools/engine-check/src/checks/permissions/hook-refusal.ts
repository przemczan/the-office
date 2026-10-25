import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { samePath } from "../paths.ts";
import { callsOn, lastOutcome, toolCalls, toolResultText } from "../tool-calls.ts";
import { observeCall } from "./call-observations.ts";
import { decideCallsOf, toolDecision } from "./hook-decisions.ts";

/**
 * A refusal the Agent reads and acts on (spec §6, other refusals): the reason names a file the prompt
 * never mentions, so a Read of it shows the model read the reason and followed it.
 */
export const hookRefusalCheck: Check = {
  id: "permissions.hook-refusal",
  title: "a PreToolUse hook refuses with a reason the Agent reads and acts on",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const refused = join(repository, "plan.txt");
    const named = join(repository, "notes.txt");
    await writeFile(refused, "The plan.\n");
    await writeFile(named, "The notes.\n");
    const reason = `Not allowed: reading plan.txt. Read ${named} instead.`;
    const session = await startSession({
      repository,
      hooks: {
        PreToolUse: decideCallsOf("Read", (path) =>
          path !== undefined && samePath(path, refused) ? toolDecision("deny", reason) : undefined,
        ),
      },
    });
    session.send(
      `Use the Read tool on ${refused}. If a tool call is refused, do what the refusal says. Then reply with just OK.`,
    );
    await session.nextResult();
    const calls = toolCalls(session.messages);
    const refusedCalls = callsOn(calls, "Read", refused);
    return {
      refusedRead: observeCall(session, refusedCalls),
      reasonReachedModel: refusedCalls.some((call) =>
        toolResultText(session.messages, call.id).includes(reason),
      ),
      readOfNamedFile: lastOutcome(callsOn(calls, "Read", named)),
    };
  },
};
