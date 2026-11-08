import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Injectable } from "@nestjs/common";
import type { CommandRun } from "../domain/command-run.js";
import type { Project, ProjectCommandKey } from "../domain/project.js";
import { TaskCommandRunner } from "./task-command-runner.js";
import type { CommandWait } from "./task-run-environments.js";
import { Worktrees } from "./worktrees.js";

/** A command an Agent runs through The Office: one of the Project's by its key, or one it wrote. */
export type AgentCommand = { readonly key: ProjectCommandKey } | { readonly commandLine: string };

/** How an Agent's command is stopped, told of a wait for its run environment, and where its output goes. */
export interface AgentCommandOptions {
  /** Stops the command, with everything it started, or its wait, with nothing run. */
  readonly signal: AbortSignal;
  readonly wait?: CommandWait;
  /** Where its whole output goes as it runs, made or replaced, its folder made if missing. */
  readonly outputFile: string;
}

/**
 * How an Agent's command went: the Project has no command by that key, the install before it
 * didn't pass so it didn't run, or it ran.
 */
export type AgentCommandEnd =
  | { readonly kind: "no-command" }
  | { readonly kind: "install-failed"; readonly run: CommandRun }
  | { readonly kind: "ran"; readonly run: CommandRun };

/** As long as a Script Stage's command may run. */
const AGENT_COMMAND_TIMEOUT_MS = 30 * 60_000;

/**
 * Runs a command for an Agent at work on a Task (spec §6, "Agents run checks through an Office
 * tool") in the Task's worktree, where the Project's Run environment setting says, as a Script
 * Stage's command runs: after an install when its inputs changed, waiting for a free run
 * environment. Unlike a Script Stage's, what it writes stays in the worktree, as the Agent's own
 * shell would leave it. A command line is run as given, on the host in the Bash Agents have:
 * whether the Agent may run it is the caller's to decide, judged as that Bash would run it.
 */
@Injectable()
export class AgentCommands {
  constructor(
    private readonly worktrees: Worktrees,
    private readonly commands: TaskCommandRunner,
  ) {}

  async run(
    project: Project,
    taskId: string,
    command: AgentCommand,
    { signal, wait, outputFile }: AgentCommandOptions,
  ): Promise<AgentCommandEnd> {
    const key = "key" in command ? command.key : undefined;
    const commandLine = "key" in command ? project.commands[command.key] : command.commandLine;
    if (commandLine.trim() === "") return { kind: "no-command" };
    // The install itself runs as asked, even with its inputs as they were.
    if (key !== "install") {
      const { installation } = await this.worktrees.prepare(project, taskId, { signal, wait });
      if (installation.kind === "ran" && installation.run.outcome !== "passed") {
        await mkdir(dirname(outputFile), { recursive: true });
        await writeFile(outputFile, installation.run.wholeOutput);
        return { kind: "install-failed", run: installation.run };
      }
    }
    const run = await this.commands.run(project, taskId, this.worktrees.pathOf(project, taskId), {
      commandLine,
      timeoutMs: AGENT_COMMAND_TIMEOUT_MS,
      signal,
      wait,
      outputFile,
      writtenByAgent: key === undefined,
    });
    return { kind: "ran", run };
  }
}
