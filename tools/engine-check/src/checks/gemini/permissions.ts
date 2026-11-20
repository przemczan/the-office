import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, Observation } from "../../check.ts";
import type { GeminiSession, GeminiSessionSpec } from "../../gemini/gemini-session.ts";
import type { BeforeToolInput, HookAnswer } from "../../gemini/office-channel.ts";
import { mcpToolName, OFFICE_SERVER } from "../../gemini/options.ts";
import {
  answeringTool,
  callStatus,
  fileWritten,
  hookSaw,
  startIn,
  toolNames,
  turnOutcome,
  wait,
  writeFileCommand,
} from "./helpers.ts";

const RAN = "ran.txt";
const REFUSED = "refused.txt";
const REFUSAL_CODE = "RULE-ZX9";
const NOTE = "note_progress";
const SHELL = "run_shell_command";

/**
 * The Office rules on every call (spec §6), through the adapter's `BeforeTool` hook and the
 * service's relay: one turn uses each core tool, an allowed command, a refused one and an Office
 * tool. Each judgement looks whether the command's file exists yet, so "before it runs" is seen, not
 * assumed; the refusal's reason carries a code word, to see whether the model read it.
 */
export const geminiToolsAndRulesCheck: Check = {
  id: "gemini.tools-and-rules",
  title: "the hook judges every tool call before it runs, and a refusal's reason reaches the model",
  async run(context) {
    const repository = await context.sandbox.createRepository("repository-rules");
    const judgedBeforeRun: boolean[] = [];
    const session = await context.startGeminiSession({
      repository,
      officeTools: [answeringTool(NOTE, "Notes progress for the user.", "Noted.")],
      decideHook: async (input) => {
        // The allowed command's own call: the refused one comes after `ran.txt` exists.
        if (input.tool_name === SHELL && JSON.stringify(input.tool_input).includes(RAN)) {
          judgedBeforeRun.push(!existsSync(join(repository, RAN)));
        }
        return refusesTheRefusedCommand(input);
      },
    });
    const turn = await session.prompt(
      [
        "Do these in order, one tool call each:",
        "1. Read README.md with read_file.",
        "2. List the top folder with list_directory.",
        "3. Find *.md files with glob.",
        '4. Search for "Engine" with grep_search.',
        '5. Write notes.txt with the text "one" using write_file.',
        '6. Change "one" to "two" in notes.txt with replace.',
        `7. Run this shell command with run_shell_command: ${writeFileCommand(RAN)}`,
        `8. Run this shell command with run_shell_command, once, and do not retry it: ${writeFileCommand(REFUSED)}`,
        `9. Call ${mcpToolName(OFFICE_SERVER, NOTE)} with the summary "done".`,
        "Then reply with the exact error message step 8 gave you.",
      ].join("\n"),
    );
    const calls = toolNames(session);
    const saw = hookSaw(session);
    return {
      ...turnOutcome(turn),
      calls,
      hookSaw: saw,
      everyCallJudged: calls.every((name) => saw.includes(name)),
      allowedCommandRan: fileWritten(repository, RAN),
      refusedCommandRan: fileWritten(repository, REFUSED),
      reasonReachedModel: turn.reply.includes(REFUSAL_CODE),
      shellJudgedBeforeItRan: judgedBeforeRun.length > 0 && judgedBeforeRun.every(Boolean),
      officeToolJudgedBeforeItRan: officeToolJudgedFirst(session),
    };
  },
};

/**
 * Why the adapter refuses a turn in a folder holding `.gemini/settings.json` (spec §5.4.7): with
 * folder trust off the CLI reads that file and ranks it above the session's own settings, so one
 * that turns hooks off leaves every call unjudged. The check's session runs regardless, to see it.
 */
export const geminiRepositorySettingsCheck: Check = {
  id: "gemini.repository-settings",
  title:
    "a repository's own .gemini/settings.json ranks above the session's and can turn the hook off",
  async run(context) {
    const repository = await context.sandbox.createRepository("repository-settings");
    await mkdir(join(repository, ".gemini"), { recursive: true });
    await writeFile(
      join(repository, ".gemini", "settings.json"),
      JSON.stringify({ hooksConfig: { enabled: false } }),
    );
    const session = await context.startGeminiSession({
      repository,
      decideHook: refusesTheRefusedCommand,
    });
    const turn = await session.prompt(
      `Run this shell command with run_shell_command, once, and do not retry it: ${writeFileCommand(REFUSED)}\nThen reply with just OK.`,
    );
    return {
      ...turnOutcome(turn),
      hookSaw: hookSaw(session),
      refusedCommandRan: fileWritten(repository, REFUSED),
    };
  },
};

async function refusesTheRefusedCommand(input: BeforeToolInput): Promise<HookAnswer> {
  return input.tool_name === SHELL && JSON.stringify(input.tool_input).includes(REFUSED)
    ? { decision: "deny", reason: `The Office rules refuse this command (${REFUSAL_CODE}).` }
    : { decision: "allow" };
}

function officeToolJudgedFirst(session: GeminiSession): boolean {
  const ran = session.officeToolCalls.find((call) => call.name === NOTE);
  if (ran === undefined) return false;
  return session.hookCalls.some(
    (call) => call.input.tool_name === mcpToolName(OFFICE_SERVER, NOTE) && call.at <= ran.at,
  );
}

/** Past the relay's own deadline (50 s) and short of the CLI's hook timeout (60 s). */
const SLOW_ANSWER_MS = 55_000;

/**
 * The Office rules refuse when they can't be asked (spec §6): the relay can't reach the channel, the
 * channel refuses its token, or the answer comes after the relay's own deadline, which is shorter
 * than the CLI's hook timeout, past which the CLI would let the call run.
 */
export const geminiHookUnreachableCheck: Check = {
  id: "gemini.hook-unreachable",
  title:
    "a call is refused when the hook can't reach the Office, is refused by it, or waits too long",
  timeoutMs: 6 * 60 * 1000,
  async run(context) {
    return {
      unreachable: await refusedCall(context, { unreachableHook: true }),
      wrongToken: await refusedCall(context, { wrongToken: true }),
      tooSlow: await refusedCall(context, {
        decideHook: async () => {
          await wait(SLOW_ANSWER_MS);
          return { decision: "allow" };
        },
      }),
    };
  },
};

async function refusedCall(
  context: Parameters<Check["run"]>[0],
  spec: Omit<GeminiSessionSpec, "repository">,
): Promise<Observation> {
  const { session, repository } = await startIn(context, spec);
  await session.prompt(
    `Run this shell command with run_shell_command, once, and do not retry: ${writeFileCommand(RAN)}\nThen reply with just OK.`,
  );
  return { commandRan: fileWritten(repository, RAN), callStatus: callStatus(session, SHELL) };
}
