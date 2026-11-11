import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import type { OfficeToolCall, OfficeToolResult } from "../../engine/index.js";
import { agentCommandAnswer, type AgentCommand } from "../domain/agent-command.js";
import { commandKeyRefusal } from "../domain/allowed-commands.js";
import { walkedStages } from "../domain/resolve-stages.js";
import type { StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads } from "../ports/stage-threads.js";
import { TaskCommands } from "../ports/task-commands.js";
import { TaskRecords } from "../ports/task-records.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageCommandRuns } from "./stage-command-runs.js";
import { StageRunWaits } from "./stage-run-waits.js";

const NOT_IN_A_STAGE =
  "This tool works in a running Agent Stage of a Task, and this session is in none.";

/**
 * An Agent's ask, mid-Stage, to run one of the Project's commands or a command line it wrote
 * (spec §6, "Agents run checks through an Office tool"): it runs where the Project's commands run,
 * in the Task's run environment when the Project has one on, waiting for a free one as a Script
 * Stage does. A line the Agent wrote runs only when the session's Office rules would let its own
 * shell run it; a command by its key is the Project's own, run as its settings say, and only one
 * the running Stage's narrowing keeps (spec §2.3), install aside. The run's
 * commands end with the run (`StageCommandRuns`), and the Agent waits for the command's end.
 */
@Injectable()
export class StageProjectCommands {
  constructor(
    private readonly threads: StageThreads,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly taskStages: TaskStagesRepository,
    private readonly commands: TaskCommands,
    private readonly commandRuns: StageCommandRuns,
    private readonly waits: StageRunWaits,
  ) {}

  async inSession(command: AgentCommand, call: OfficeToolCall): Promise<OfficeToolResult> {
    const taskId = await this.threads.taskInSession(call.sessionId);
    const runs = taskId === undefined ? [] : await this.runs.list(taskId);
    const run = runs.findLast(({ outcome }) => outcome === undefined);
    if (!run) return { text: NOT_IN_A_STAGE, isError: true };
    const { project } = await this.records.read(run.taskId);
    if ("commandLine" in command) {
      const judgement = await call.judgeCommand(command.commandLine);
      if (!judgement.allowed) return { text: judgement.reason, isError: true };
    } else {
      const narrowing = await this.narrowingOf(run, runs);
      const refusal = commandKeyRefusal(command.key, project.commands, narrowing);
      if (refusal !== undefined) return { text: refusal, isError: true };
    }
    const outputFile = join(call.outputFolder, `command-${randomUUID()}.log`);
    const end = await this.commandRuns.during(run.id, (signal) =>
      this.commands.runForAgent(project.id, run.taskId, command, {
        signal,
        wait: this.waits.of(run),
        outputFile,
      }),
    );
    if (end === undefined) return { text: NOT_IN_A_STAGE, isError: true };
    return agentCommandAnswer(command, end, outputFile);
  }

  /** The running Stage's narrowing of the Project's commands, as `allowedCommands` briefed it. */
  private async narrowingOf(
    run: StageRun,
    runs: readonly StageRun[],
  ): Promise<readonly string[] | undefined> {
    const own = await this.taskStages.find(run.taskId);
    const stage = walkedStages(own?.stages ?? [], runs).find(({ key }) => key === run.stageKey);
    return stage?.kind === "agent" ? stage.permissions?.commands : undefined;
  }
}
