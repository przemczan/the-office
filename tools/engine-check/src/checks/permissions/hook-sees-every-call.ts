import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { sortedNames } from "../observations.ts";
import { rulePath } from "../paths.ts";
import { callsOn, toolCalls } from "../tool-calls.ts";
import { observeCall, seenFirstByPreToolUse } from "./call-observations.ts";

/**
 * The Office's one `PreToolUse` hook must see every call before the engine answers it (spec §6), so
 * the calls cover each way the engine answers under `permissionPrompts: 'none'`: allowed, refused by a
 * deny rule, by the read fence, for want of an approval surface, and a subagent's own call.
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
    const session = await startSession({ repository, settings: { permissions: { deny: [`Read(${rulePath(secret)})`] } } });
    session.send(
      "Make these tool calls one at a time, in this order. Do not retry a refused call and do not use any other tool. Then reply with just OK.\n" +
        `1. Read ${readme}\n2. Read ${secret}\n3. Read ${outside}\n4. Write ${written} with the content: check`,
    );
    await session.nextResult();
    session.send(
      `Use the Task tool once to start a general-purpose subagent with this prompt: "Use the Read tool on ${forSubagent}, then reply with just OK." Then reply with just OK.`,
    );
    await session.nextResult();
    const calls = toolCalls(session.messages);
    return {
      calls: {
        allowedRead: observeCall(session, callsOn(calls, "Read", readme)),
        readDeniedByRule: observeCall(session, callsOn(calls, "Read", secret)),
        readOutsideWorkingDirectory: observeCall(session, callsOn(calls, "Read", outside)),
        writeWithoutApproval: observeCall(session, callsOn(calls, "Write", written)),
        subagentRead: observeCall(session, callsOn(calls, "Read", forSubagent)),
      },
      toolsNotSeenFirst: sortedNames(calls.filter((call) => !seenFirstByPreToolUse(session, call)).map((call) => call.name)),
    };
  },
};
