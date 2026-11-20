import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Check, Observation } from "../../check.ts";
import type { HookAnswer } from "../../gemini/office-channel.ts";
import { mcpToolName, OFFICE_SERVER, type GeminiTransport } from "../../gemini/options.ts";
import type { GeminiSession } from "../../gemini/gemini-session.ts";
import {
  fileWritten,
  nodeCommand,
  onBothTransports,
  sortedUnique,
  startIn,
  toolNames,
  turnOutcome,
} from "./helpers.ts";

const RAN = "ran.txt";
const RUN_COMMAND = nodeCommand(`require('fs').writeFileSync('${RAN}', 'x')`);
const NOTE = "note_progress";
const noteTool = {
  name: NOTE,
  description: "Notes progress for the user.",
  inputSchema: { type: "object", properties: { summary: { type: "string" } } },
  run: async () => ({ text: "Noted." }),
};

/**
 * Whether every call, built-in and Office tool, is judged before it runs (spec §6): headless by the
 * `BeforeTool` hook, over ACP by the permission request the ask-every-call policy makes. Each
 * decision looks whether the command's file exists yet, so "before it runs" is seen, not assumed;
 * the hook is set on ACP too, to see whether it fires there.
 */
export const geminiHookSeesEveryCallCheck: Check = {
  id: "gemini.hook-sees-every-call",
  title: "every tool call is judged before it runs",
  async run(context) {
    return onBothTransports(async (transport) => {
      const repository = await context.sandbox.createRepository(`repository-${transport}`);
      const judgedBeforeRun: boolean[] = [];
      const judge = (toolName: string): void => {
        if (toolName === "run_shell_command") {
          judgedBeforeRun.push(!existsSync(join(repository, RAN)));
        }
      };
      const session = await context.startGeminiSession({
        transport,
        repository,
        officeTools: [noteTool],
        decideHook: async (input) => {
          judge(input.tool_name);
          return { decision: "allow" };
        },
        decidePermission: async (request) => {
          judge(request.toolName);
          return "allow";
        },
      });
      const turn = await session.prompt(
        [
          "Do these in order, one tool call each:",
          "1. Read README.md with read_file.",
          `2. Run this shell command with run_shell_command: ${RUN_COMMAND}`,
          `3. Call ${mcpToolName(OFFICE_SERVER, NOTE)} with the summary "done".`,
          "Then reply with just OK.",
        ].join("\n"),
      );
      return {
        ...turnOutcome(turn),
        calls: toolNames(session),
        ...judgedBy(session, transport),
        shellJudgedBeforeItRan: judgedBeforeRun.length > 0 && judgedBeforeRun.every(Boolean),
        officeToolJudgedBeforeItRan: officeToolJudgedFirst(session),
      };
    });
  },
};

function judgedBy(session: GeminiSession, transport: GeminiTransport): Observation {
  const hookSaw = sortedUnique(session.hookCalls.map((call) => call.input.tool_name));
  if (transport === "headless") {
    return { hookSaw };
  }
  return {
    hookSaw,
    permissionAskedFor: sortedUnique(session.permissionRequests.map((request) => request.toolName)),
    permissionCarriesArguments: session.permissionRequests.some(
      (request) => request.carriesArguments,
    ),
    permissionNamesMcpTool: session.permissionRequests.some(
      (request) => request.mcp?.tool_name === NOTE,
    ),
    permissionOptions: sortedUnique(
      session.permissionRequests.flatMap((request) => request.optionIds),
    ),
  };
}

function officeToolJudgedFirst(session: GeminiSession): boolean {
  const ran = session.officeToolCalls.find((call) => call.name === NOTE);
  if (ran === undefined) {
    return false;
  }
  const judged = [
    ...session.hookCalls
      .filter((call) => call.input.tool_name === mcpToolName(OFFICE_SERVER, NOTE))
      .map((call) => call.at),
    ...session.permissionRequests
      .filter((request) => request.mcp?.tool_name === NOTE)
      .map((request) => request.at),
  ];
  return judged.some((at) => at <= ran.at);
}

const REFUSAL_CODE = "RULE-ZX9";

/**
 * A refusal and its reason (spec §6): headless the hook denies with a reason carrying a code word;
 * over ACP the permission request is rejected, which has no reason to carry. Whether the model saw
 * the reason, and whether the turn went on, is recorded.
 */
export const geminiHookRefusalCheck: Check = {
  id: "gemini.hook-refusal",
  title: "a refused call doesn't run, its reason reaches the model, and the turn goes on",
  async run(context) {
    return onBothTransports(async (transport) => {
      const refuse = async (): Promise<HookAnswer> => ({
        decision: "deny",
        reason: `The Office rules refuse this (${REFUSAL_CODE}).`,
      });
      const { session, repository } = await startIn(context, transport, {
        decideHook: refuse,
        decidePermission: async () => "reject",
      });
      const turn = await session.prompt(
        `Run this shell command with run_shell_command, once, and do not retry: ${RUN_COMMAND}\nThen reply with the exact error message the tool call gave you.`,
      );
      return {
        ...turnOutcome(turn),
        commandRan: fileWritten(repository, RAN),
        reasonReachedModel: turn.reply.includes(REFUSAL_CODE),
        callStatus:
          session.toolCalls.find((call) => call.name === "run_shell_command")?.status ?? "none",
      };
    });
  },
};

/**
 * A failing hook (spec §6: the Office rules refuse when they can't be asked): the relay can't reach
 * the channel and exits 2; and a hook slower than its timeout. Headless only, as ACP runs no
 * `BeforeTool` hook.
 */
export const geminiHookUnreachableCheck: Check = {
  id: "gemini.hook-unreachable",
  title: "a call is refused when the hook can't reach the Office, and what a timed-out hook does",
  async run(context) {
    const unreachable = await startIn(context, "headless", { unreachableHook: true });
    await unreachable.session.prompt(
      `Run this shell command with run_shell_command, once, and do not retry: ${RUN_COMMAND}\nThen reply with just OK.`,
    );
    const slow = await context.sandbox.createRepository("repository-slow-hook");
    const timedOut = await context.startGeminiSession({
      transport: "headless",
      repository: slow,
      hookTimeoutMs: 3000,
      decideHook: async () => {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        return { decision: "deny", reason: "Too late." };
      },
    });
    await timedOut.prompt(
      `Run this shell command with run_shell_command, once, and do not retry: ${RUN_COMMAND}\nThen reply with just OK.`,
    );
    return {
      unreachable: {
        commandRan: fileWritten(unreachable.repository, RAN),
        callStatus: callStatus(unreachable.session),
      },
      timedOut: { commandRan: fileWritten(slow, RAN), callStatus: callStatus(timedOut) },
    };
  },
};

function callStatus(session: GeminiSession): string {
  return session.toolCalls.find((call) => call.name === "run_shell_command")?.status ?? "none";
}
