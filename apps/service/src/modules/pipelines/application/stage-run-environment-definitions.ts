import { Injectable } from "@nestjs/common";
import type { OfficeToolCall, OfficeToolResult } from "../../engine/index.js";
import {
  RunEnvironmentDefinitions,
  type RunEnvironmentDefinitionFile,
  type RunEnvironmentDefinitionWriting,
} from "../ports/run-environment-definitions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads } from "../ports/stage-threads.js";
import { TaskConsultations, type TaskConsultation } from "../ports/task-consultations.js";
import { TaskRecords } from "../ports/task-records.js";

const NOT_IN_A_STAGE =
  "This tool works in a running Agent Stage of a Task, and this session is in none.";

const NO_CAPABILITY =
  "The Office wrote nothing: your Role card doesn't have the Run environment capability, which writing the run environment definition in a Consultation needs.";

const ANOTHER_STAGE_RUNS =
  "The Office wrote nothing: another Stage of the Task is running and may change its worktree. Ask again once it has ended.";

/**
 * An Agent's ask, mid-Stage, to write the Project's run environment definition (spec §5.5, §6):
 * Write and Edit can't reach `.devcontainer/`, so The Office checks the files as it would read
 * them and writes them into the Task's worktree only when the definition is valid. It builds and
 * starts nothing. A Consultant with the Run environment capability, consulted on a Task, writes it
 * too: The Office commits only `.devcontainer/` on the Task's branch, as no Stage commits it after.
 */
@Injectable()
export class StageRunEnvironmentDefinitions {
  constructor(
    private readonly threads: StageThreads,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly definitions: RunEnvironmentDefinitions,
    private readonly consultations: TaskConsultations,
  ) {}

  async inSession(
    files: readonly RunEnvironmentDefinitionFile[],
    { sessionId }: OfficeToolCall,
  ): Promise<OfficeToolResult> {
    // A Consultation's own Thread is on the Task too, so it is told apart before a Stage's session.
    const consultation = await this.consultations.consultationOnTask(sessionId);
    if (consultation) return this.inConsultation(files, consultation);
    const taskId = await this.threads.taskInSession(sessionId);
    const run =
      taskId === undefined
        ? undefined
        : (await this.runs.list(taskId)).findLast(({ outcome }) => outcome === undefined);
    if (!run) return { text: NOT_IN_A_STAGE, isError: true };
    const { worktree } = await this.records.read(run.taskId);
    return writingAnswer(await this.definitions.write(worktree.path, files));
  }

  /**
   * The Consultant's write, one writer at a time: refused while a Stage of the Task runs other
   * than the one whose Stage Thread asked and waits on the Consultation.
   */
  private async inConsultation(
    files: readonly RunEnvironmentDefinitionFile[],
    { taskId, askingThreadId, decisionId, consultant, runEnvironment }: TaskConsultation,
  ): Promise<OfficeToolResult> {
    if (!runEnvironment) return { text: NO_CAPABILITY, isError: true };
    const runs = await this.runs.list(taskId);
    const running = runs.filter(({ outcome }) => outcome === undefined);
    if (running.some(({ threadId }) => threadId !== askingThreadId)) {
      return { text: ANOTHER_STAGE_RUNS, isError: true };
    }
    const { worktree } = await this.records.read(taskId);
    const by = `Run environment definition, by ${consultant.name} (${consultant.roleTitle})`;
    const writing = await this.definitions.writeAndCommit(worktree.path, files, by);
    if (!writing.written) return writingAnswer(writing);
    // The asking Stage's run, running or waiting on the answer, now left the branch at the commit,
    // so the Stage's end, or its next run, expects HEAD there rather than refusing the move. Asked
    // from a person's Thread on the Task, the run the next Stage reads its expected HEAD from does.
    const left =
      runs.findLast(({ threadId }) => threadId === askingThreadId) ??
      runs.findLast(({ headCommit }) => headCommit !== undefined);
    if (left) await this.runs.saveHeadCommit(left.id, writing.commit);
    const commit = writing.commit.slice(0, 7);
    await this.consultations.logOfficeLine(
      askingThreadId,
      decisionId,
      `${by}: commit ${commit}, ${writing.paths.join(", ")}.`,
    );
    return {
      text: `The run environment definition is valid; the checks run in the service "${writing.service}". The Office wrote ${writing.paths.join(", ")} and committed them on the Task's branch as ${commit}. It checked the files only, building and starting nothing.`,
      isError: false,
    };
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
