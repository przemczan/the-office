import { z } from "zod";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { AgentShell, AgentShellProgram } from "../../../../platform/os/shell.js";
import type { BackgroundCommands, BackgroundStart } from "./background-commands.js";
import {
  builtInTool,
  failure,
  success,
  type BuiltInTool,
  type ToolOutput,
} from "./built-in-tool.js";
import { runShellCommand, type CommandEnding } from "./shell-command.js";

/** Claude Code's limits on a foreground command: two minutes unless the call asks, ten at most. */
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

/** How much of a command's output the model reads, as Claude Code cuts it: the end is kept. */
const OUTPUT_LIMIT = 30_000;

/** Each shell under the Claude Code engines' tool name, which the Office rules judge it by. */
const TOOL_NAMES: Readonly<Record<AgentShell, string>> = { bash: "Bash", powershell: "PowerShell" };

const shellInput = z.object({
  command: z.string().min(1).describe("The command to execute"),
  timeout: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(`Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS})`),
  description: z
    .string()
    .optional()
    .describe("Clear, concise description of what this command does in 5-10 words"),
  run_in_background: z
    .boolean()
    .optional()
    .describe(
      "Set to true to run this command in the background. Use Read to read the output later.",
    ),
});

/**
 * Claude Code's Bash or PowerShell: one command line run in the session's folder and environment,
 * either to its end, its whole tree ended on interrupt or once its time is up, or in the
 * background, where it runs on until it exits, TaskStop stops it or the session ends it.
 */
export function shellTool(
  program: AgentShellProgram,
  processTrees: ProcessTrees,
  backgroundCommands: BackgroundCommands,
): BuiltInTool {
  return builtInTool({
    name: TOOL_NAMES[program.shell],
    description: [
      `Runs a command line in ${program.name} in your working folder and returns its output.`,
      `- It waits for the command to end, ${DEFAULT_TIMEOUT_MS / 60_000} minutes at most unless \`timeout\` asks for more (up to ${MAX_TIMEOUT_MS / 60_000}).`,
      "- With `run_in_background`, it answers at once with the command's id and the file its output is written to; read that file with Read, and stop the command with TaskStop.",
      "- Use Read, Grep and Glob rather than shell commands to read and search files.",
    ].join("\n"),
    input: shellInput,
    run: async (input, context, signal) => {
      const command = {
        commandLine: input.command,
        folder: context.folder,
        environment: context.environment,
      };
      if (input.run_in_background === true) {
        return backgroundOutput(
          await backgroundCommands.start(
            program,
            command,
            input.description ?? input.command,
            context.callId,
          ),
        );
      }
      const timeoutMs = input.timeout ?? DEFAULT_TIMEOUT_MS;
      return shellOutput(
        await runShellCommand(program, processTrees, { ...command, timeoutMs, signal }),
        timeoutMs,
      );
    },
  });
}

/** What Claude Code answers when a command goes to the background. */
function backgroundOutput(start: BackgroundStart): ToolOutput {
  if (start.kind === "not-started") return failure(start.problem);
  return success(
    `Command running in background with ID: ${start.id}. Output is being written to: ${start.outputFile}`,
  );
}

function shellOutput(ending: CommandEnding, timeoutMs: number): ToolOutput {
  switch (ending.kind) {
    case "not-started":
      return failure(ending.problem);
    case "timed-out":
      return failure(
        withOutput(
          `The command ran out of time after ${timeoutMs} ms and was ended.`,
          ending.output,
        ),
      );
    case "stopped":
      return failure(withOutput("The command was stopped.", ending.output));
    case "exited":
      if (ending.exitCode === 0)
        return success(cut(ending.output) || "(The command printed nothing.)");
      return failure(withOutput(`Exit code ${ending.exitCode ?? "none"}`, ending.output));
  }
}

function withOutput(heading: string, output: string): string {
  const text = cut(output);
  return text === "" ? heading : `${heading}\n${text}`;
}

/** The output without its trailing whitespace, cut to its last OUTPUT_LIMIT characters. */
function cut(output: string): string {
  const text = output.trimEnd();
  if (text.length <= OUTPUT_LIMIT) return text;
  const left = text.length - OUTPUT_LIMIT;
  return `[${left} characters of output cut from the start]\n${text.slice(left)}`;
}
