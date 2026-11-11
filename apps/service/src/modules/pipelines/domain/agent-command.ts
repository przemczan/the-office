import type { CommandRun } from "./stage-command-run.js";

/**
 * A command an Agent runs through The Office: install or one of the Project's commands by its key,
 * or one it wrote.
 */
export type AgentCommand = { readonly key: string } | { readonly commandLine: string };

/**
 * The command an Agent asked for with the tool's two inputs, or why its ask names none: it gives
 * exactly one of them.
 */
export function agentCommandOf(
  key: string | undefined,
  commandLine: string | undefined,
): AgentCommand | string {
  const given = key?.trim() ?? "";
  const written = commandLine?.trim() ?? "";
  if (given !== "" && written !== "") {
    return "Give either command or commandLine, not both.";
  }
  if (given !== "") return { key: given };
  if (written !== "") return { commandLine: written };
  return "Give the command to run: command, install or one of the Project's commands by its key, or commandLine.";
}

/**
 * How an Agent's command went: the Project has no command by that key, the install before it
 * didn't pass so it didn't run, or it ran.
 */
export type AgentCommandEnd =
  | { readonly kind: "no-command" }
  | { readonly kind: "install-failed"; readonly run: CommandRun }
  | { readonly kind: "ran"; readonly run: CommandRun };

/** The command's words for the Agent: its key and line, or the line it wrote. */
function named(command: AgentCommand, run: CommandRun | undefined): string {
  if (!("key" in command)) return `\`${command.commandLine}\``;
  return run === undefined
    ? `The ${command.key} command`
    : `The ${command.key} command \`${run.commandLine}\``;
}

/**
 * What the Agent who ran a command through The Office is answered (spec §6): how it ended, with
 * its exit code, and the file with its whole output; the lines that tell why when it didn't pass.
 * A run that ended with an exit code is no failed call, whatever the code: the Agent reads it.
 */
export function agentCommandAnswer(
  command: AgentCommand,
  end: AgentCommandEnd,
  outputFile: string,
): { readonly text: string; readonly isError: boolean } {
  if (end.kind === "no-command") {
    const key = "key" in command ? command.key : "command";
    return {
      text: `The Project has no ${key} command, or its settings leave it empty, so nothing ran. Run a command line instead, if you may.`,
      isError: true,
    };
  }
  const { run } = end;
  const whole = `Its whole output is in ${outputFile}; read it with Read.`;
  if (end.kind === "install-failed") {
    return {
      text: `${named(command, undefined)} didn't run: the install before it, \`${run.commandLine}\`, ${endedIn(run)}. ${whole}${lastLines(run)}`,
      isError: true,
    };
  }
  const exited = run.outcome === "passed" || run.outcome === "failed";
  return {
    text: `${named(command, run)} ${endedIn(run)}. ${whole}${run.outcome === "passed" ? "" : lastLines(run)}`,
    isError: !exited,
  };
}

function endedIn(run: CommandRun): string {
  const seconds = `${Math.round(run.durationMs / 1000)} s`;
  switch (run.outcome) {
    case "passed":
      return `passed, exit code 0, in ${seconds}`;
    case "failed":
      return `failed, exit code ${run.exitCode ?? "unknown"}, in ${seconds}`;
    case "could-not-run":
      return "couldn't run";
    case "timed-out":
      return `did not finish in time and was stopped, with everything it started, after ${seconds}`;
    case "stopped":
      return "was stopped by The Office, with everything it started";
  }
}

/** The lines of its output that tell why, as a Script Stage's failure shows them. */
function lastLines(run: CommandRun): string {
  return run.output.trim() === "" ? "" : `\n\nWhat tells why:\n\`\`\`\n${run.output}\n\`\`\``;
}
