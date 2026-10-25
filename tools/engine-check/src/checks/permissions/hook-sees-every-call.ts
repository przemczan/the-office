import type { SDKTaskNotificationMessage, SDKTaskStartedMessage } from "@anthropic-ai/claude-agent-sdk";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { sortedNames } from "../observations.ts";
import { rulePath } from "../paths.ts";
import { callsOn, toolCalls, type ToolCall } from "../tool-calls.ts";
import { observeCall, seenFirstByPreToolUse } from "./call-observations.ts";

/**
 * The Office's one `PreToolUse` hook must see every call before any rule decides it (spec §6), so the
 * calls cover each way the engine answers under `permissionPrompts: 'none'`: allowed, refused by the
 * read fence, for want of an approval surface, and a subagent's own call. A path-scoped deny rule is
 * the counter-example: it refuses before the hook, which is why the Office sets none.
 */
export const hookSeesEveryCallCheck: Check = {
  id: "permissions.hook-sees-every-call",
  title: "a PreToolUse hook sees every tool call first under permissionPrompts 'none', a subagent's included",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const readme = join(repository, "README.md");
    const secret = join(repository, "secret.txt");
    const outside = join(sandbox.root, "outside.txt");
    const written = join(repository, "written.txt");
    const forSubagent = join(repository, "subagent.txt");
    await writeFile(secret, "Denied by a rule.\n");
    await writeFile(forSubagent, "Read by a subagent.\n");
    await writeFile(outside, "Outside the working directory.\n");
    const [main, subagent] = await Promise.all([
      startSession({ repository, settings: { permissions: { deny: [`Read(${rulePath(secret)})`] } } }).then((session) =>
        runTurn(
          session,
          "Make these tool calls one at a time, in this order. Do not retry a refused call and do not use any other tool. Then reply with just OK.\n" +
            `1. Read ${readme}\n2. Read ${secret}\n3. Read ${outside}\n4. Write ${written} with the content: check`,
        ),
      ),
      // A session of its own: after the refusals above, the model at times declined to start the subagent.
      startSession({ repository }).then((session) =>
        runTurn(
          session,
          `Use the Task tool once to start a general-purpose subagent with this prompt: "Use the Read tool on ${forSubagent}, then reply with just OK." Then reply with just OK.`,
        ),
      ),
    ]);
    return {
      calls: {
        allowedRead: observeCall(main.session, callsOn(main.calls, "Read", readme)),
        readDeniedByRule: observeCall(main.session, callsOn(main.calls, "Read", secret)),
        readOutsideWorkingDirectory: observeCall(main.session, callsOn(main.calls, "Read", outside)),
        writeWithoutApproval: observeCall(main.session, callsOn(main.calls, "Write", written)),
        subagentRead: observeCall(subagent.session, callsOn(subagent.calls, "Read", forSubagent)),
      },
      toolsNotSeenFirst: sortedNames([main, subagent].flatMap(({ session, calls }) => notSeenFirst(session, calls))),
    };
  },
};

async function runTurn(session: ProbeSession, prompt: string): Promise<{ session: ProbeSession; calls: ToolCall[] }> {
  session.send(prompt);
  await session.nextResult();
  await backgroundTasksEnded(session);
  return { session, calls: toolCalls(session.messages) };
}

/** The engine may run a subagent in the background past its turn's result; its calls count once it has ended. */
async function backgroundTasksEnded(session: ProbeSession): Promise<void> {
  const started = session.messages.filter((message): message is SDKTaskStartedMessage => message.type === "system" && message.subtype === "task_started");
  await Promise.all(
    started.map((task) =>
      session.waitForMessage(
        (message): message is SDKTaskNotificationMessage =>
          message.type === "system" && message.subtype === "task_notification" && message.task_id === task.task_id,
      ),
    ),
  );
}

function notSeenFirst(session: ProbeSession, calls: readonly ToolCall[]): string[] {
  return calls.filter((call) => !seenFirstByPreToolUse(session, call)).map((call) => call.name);
}
