import { Injectable } from "@nestjs/common";
import type { OfficeToolCall, OfficeToolResult } from "../../engine/index.js";
import {
  RunEnvironmentDefinitions,
  type RunEnvironmentDefinitionFile,
  type RunEnvironmentDefinitionWriting,
} from "../ports/run-environment-definitions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads } from "../ports/stage-threads.js";
import { TaskRecords } from "../ports/task-records.js";

const NOT_IN_A_STAGE =
  "This tool works in a running Agent Stage of a Task, and this session is in none.";

/**
 * An Agent's ask, mid-Stage, to write the Project's run environment definition (spec §5.5, §6):
 * Write and Edit can't reach `.devcontainer/`, so The Office checks the files as it would read
 * them and writes them into the Task's worktree only when the definition is valid. It builds and
 * starts nothing.
 */
@Injectable()
export class StageRunEnvironmentDefinitions {
  constructor(
    private readonly threads: StageThreads,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly definitions: RunEnvironmentDefinitions,
  ) {}

  async inSession(
    files: readonly RunEnvironmentDefinitionFile[],
    { sessionId }: OfficeToolCall,
  ): Promise<OfficeToolResult> {
    const taskId = await this.threads.taskInSession(sessionId);
    const run =
      taskId === undefined
        ? undefined
        : (await this.runs.list(taskId)).findLast(({ outcome }) => outcome === undefined);
    if (!run) return { text: NOT_IN_A_STAGE, isError: true };
    const { worktree } = await this.records.read(run.taskId);
    return writingAnswer(await this.definitions.write(worktree.path, files));
  }
}

function writingAnswer(writing: RunEnvironmentDefinitionWriting): OfficeToolResult {
  if (!writing.written) {
    return {
      text: [
        "The Office wrote nothing: the run environment definition has these problems.",
        ...writing.problems.map((problem) => `- ${problem}`),
      ].join("\n"),
      isError: true,
    };
  }
  return {
    text: `The run environment definition is valid; the checks run in the service "${writing.service}". The Office wrote ${writing.paths.join(", ")} into the worktree. It checked the files only, building and starting nothing.`,
    isError: false,
  };
}
