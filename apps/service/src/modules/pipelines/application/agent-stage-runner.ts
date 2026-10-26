import { Injectable, type OnModuleInit } from "@nestjs/common";
import { READ_ONLY_GIT_COMMANDS } from "../../engine/index.js";
import {
  AGENT_STAGE_INSTRUCTIONS,
  agentStageRecord,
  agentStageWork,
  type EarlierResult,
} from "../domain/agent-stage-brief.js";
import { allowedCommands } from "../domain/allowed-commands.js";
import type { Stage } from "../domain/stage.js";
import type { CarriedFailure, StageOutcome, StageRun } from "../domain/stage-run.js";
import {
  correctionMessage,
  readStageResult,
  STAGE_RESULT_SCHEMA,
  type StageResultReading,
} from "../domain/stage-result.js";
import { KnownPeople, type KnownPerson } from "../ports/known-people.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads, type StageThread, type StageTurn } from "../ports/stage-threads.js";
import { TaskDiffs } from "../ports/task-diffs.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/** The Office tools of an Agent Stage's session: it reads its Task and the Task's Attachments. */
export const AGENT_STAGE_OFFICE_TOOLS = ["read_task", "read_attachment"] as const;

type Ending = Parameters<StageThread["end"]>[0];

/**
 * Runs Agent Stages (spec §2.3): the person who fills the Stage's Role works it in its Stage Thread,
 * in the session the Context policy gives it with the Stage's declared session, briefed from the
 * record. Its result is read against the result schema, corrected once in the same session when it
 * doesn't match (research §6), and becomes the run's outcome with its Handover note.
 */
@Injectable()
export class AgentStageRunner implements StageRunner<"agent">, OnModuleInit {
  constructor(
    private readonly runners: StageRunners,
    private readonly records: TaskRecords,
    private readonly people: KnownPeople,
    private readonly threads: StageThreads,
    private readonly diffs: TaskDiffs,
    private readonly runs: StageRunRepository,
  ) {}

  onModuleInit(): void {
    this.runners.register("agent", this);
  }

  async run(work: StageWork<"agent">): Promise<StageOutcome> {
    const { stage } = work;
    const person = await this.people.find(stage.role);
    if (!person) {
      return {
        status: "failed",
        error: `Nobody fills the Role "${stage.role}" this Stage needs: hire them on People.`,
      };
    }
    const thread = await this.open(work, person, await this.records.read(work.run.taskId));
    let ending: Ending = { handoverNote: undefined, failure: undefined };
    try {
      await this.runs.saveThread(work.run.id, thread.threadId);
      const outcome = await this.resultOf(thread);
      ending = endingOf(outcome);
      return outcome;
    } catch (error) {
      ending = { handoverNote: undefined, failure: messageOf(error) };
      throw error;
    } finally {
      await thread.end(ending);
    }
  }

  private async open(
    { stage, run, stages, earlierRuns }: StageWork<"agent">,
    { card }: KnownPerson,
    task: TaskRecord,
  ): Promise<StageThread> {
    const commands = allowedCommands(
      card.permissionProfile.run,
      task.project.commands,
      READ_ONLY_GIT_COMMANDS,
    );
    const record = agentStageRecord({
      task: {
        title: task.title,
        plan: task.plan,
        definitionOfDone: task.definitionOfDone,
        attachmentLines: task.attachmentLines,
        projectName: task.project.name,
        baseBranch: task.project.baseBranch,
        worktree: task.worktree,
      },
      earlier: earlierResults(stages, earlierRuns),
      diffSummary: await this.diffs.summaryOf(run.taskId),
      commands,
    });
    return this.threads.open({
      taskId: run.taskId,
      roleKey: stage.role,
      stageName: stage.name,
      declared: stage.session,
      previousThreadId: previousAgentThread(stages, earlierRuns),
      record,
      work: agentStageWork(stage, carriedWithName(stages, run.carriedFailure)),
      folder: task.worktree.path,
      environment: task.worktree.environment,
      useProjectSkills: task.project.useProjectSkills,
      session: {
        instructions: AGENT_STAGE_INSTRUCTIONS,
        profile: {
          edit: card.permissionProfile.edit,
          run: commands.permission,
          web: card.permissionProfile.web,
        },
        officeTools: AGENT_STAGE_OFFICE_TOOLS,
        outputSchema: STAGE_RESULT_SCHEMA,
      },
    });
  }

  /** The Stage's result, corrected once in the same session when it doesn't match the schema. */
  private async resultOf(thread: StageThread): Promise<StageOutcome> {
    const first = readingOf(await thread.nextTurn());
    if (first.valid) return first.outcome;
    const corrected = readingOf(
      await thread.send(
        correctionMessage(first.problems),
        `The result didn't match the Stage's result schema, so The Office asked once to correct it: ${first.problems}`,
      ),
    );
    if (corrected.valid) return corrected.outcome;
    return {
      status: "failed",
      error: `The Stage's result still didn't match its schema after one correction: ${corrected.problems}`,
    };
  }
}

function readingOf({ output, problem }: StageTurn): StageResultReading {
  if (output === undefined) {
    return { valid: false, problems: problem ?? "The turn ended without a result." };
  }
  return readStageResult(output);
}

function endingOf(outcome: StageOutcome): Ending {
  return {
    handoverNote: outcome.handoverNote,
    failure: outcome.status === "failed" ? outcome.error : undefined,
  };
}

function stageOf(stages: readonly Stage[], key: string): Stage | undefined {
  return stages.find((stage) => stage.key === key);
}

/** The ended runs before this one, with their Stages' names, in the order they ran. */
function earlierResults(
  stages: readonly Stage[],
  earlierRuns: readonly StageRun[],
): EarlierResult[] {
  return earlierRuns.flatMap(({ stageKey, outcome }) => {
    const stage = stageOf(stages, stageKey);
    return stage && outcome ? [{ stageName: stage.name, kind: stage.kind, outcome }] : [];
  });
}

/** The previous run's Stage Thread, when an Agent worked it: the one a Stage may continue. */
function previousAgentThread(
  stages: readonly Stage[],
  earlierRuns: readonly StageRun[],
): string | undefined {
  const previous = earlierRuns.at(-1);
  if (!previous || stageOf(stages, previous.stageKey)?.kind !== "agent") return undefined;
  return previous.threadId;
}

function carriedWithName(
  stages: readonly Stage[],
  carried: CarriedFailure | undefined,
): (CarriedFailure & { readonly stageName: string }) | undefined {
  if (!carried) return undefined;
  return { ...carried, stageName: stageOf(stages, carried.stageKey)?.name ?? carried.stageKey };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
