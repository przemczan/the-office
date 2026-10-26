import { Injectable, type OnModuleInit } from "@nestjs/common";
import { READ_ONLY_GIT_COMMANDS } from "../../engine/index.js";
import {
  AGENT_STAGE_INSTRUCTIONS,
  agentStageRecord,
  agentStageWork,
  type AnsweredQuestion,
  type EarlierResult,
} from "../domain/agent-stage-brief.js";
import { allowedCommands } from "../domain/allowed-commands.js";
import { installFailure } from "../domain/script-stage-outcome.js";
import { stageCommitMessage, type ExpectedHead } from "../domain/stage-commit.js";
import { failedInstall, installRuns } from "../domain/stage-command-run.js";
import type { Stage } from "../domain/stage.js";
import { budgetOutcome, budgetReached } from "../domain/stage-budget.js";
import {
  addTokens,
  NO_STAGE_TOKENS,
  type CarriedFailure,
  type StageOutcome,
  type StageRun,
} from "../domain/stage-run.js";
import {
  correctionMessage,
  readStageResult,
  STAGE_RESULT_SCHEMA,
  type StageResultReading,
} from "../domain/stage-result.js";
import { KnownPeople, type KnownPerson } from "../ports/known-people.js";
import { acceptedIssues } from "../domain/walk-decisions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads, type StageThread, type StageTurn } from "../ports/stage-threads.js";
import { TaskCommands } from "../ports/task-commands.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
import { TaskUsage } from "../ports/task-usage.js";
import { StageGit } from "./stage-git.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/** The Office tools of an Agent Stage's session: it reads its Task and the Task's Attachments. */
export const AGENT_STAGE_OFFICE_TOOLS = ["read_task", "read_attachment"] as const;

type Ending = Parameters<StageThread["end"]>[0];

/**
 * Runs Agent Stages (spec §2.3): the person who fills the Stage's Role works it in its Stage Thread,
 * in the session the Context policy gives it with the Stage's declared session, briefed from the
 * record, with the Project's dependencies installed first. Its result is read against the result schema, corrected once in the same session when it
 * doesn't match (research §6), and becomes the run's outcome with its Handover note. Then The Office
 * ends the session with what it left running, checks git is where it left it, and commits the
 * Stage's work (spec §5.5).
 */
@Injectable()
export class AgentStageRunner implements StageRunner<"agent">, OnModuleInit {
  constructor(
    private readonly runners: StageRunners,
    private readonly records: TaskRecords,
    private readonly people: KnownPeople,
    private readonly threads: StageThreads,
    private readonly git: TaskGit,
    private readonly stageGit: StageGit,
    private readonly commands: TaskCommands,
    private readonly runs: StageRunRepository,
    private readonly usage: TaskUsage,
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
    // Before the session's first engine call; a budget reached leaves git and the worktree alone.
    const reached = await this.budgetCheck(work);
    if (reached) return reached;
    const task = await this.records.read(work.run.taskId);
    const { expected, refusal } = await this.stageGit.start(work, task);
    if (refusal) return refusal;
    const installation = await this.commands.install(task.project.id, work.run.taskId);
    await this.runs.saveCommandRuns(work.run.id, installRuns(installation));
    const failed = failedInstall(installation);
    const thread = await this.open(work, person, task, failed && installFailure(failed));
    let ending: Ending = { handoverNote: undefined, failure: undefined };
    try {
      await this.runs.saveThread(work.run.id, thread.threadId, thread.move.move);
      const result = await this.resultOf(work, thread);
      // Before git is read, so a dev server or a watcher it started can't change the worktree.
      await thread.endSession();
      const outcome = await this.commitWork(work, task, expected, result);
      ending = endingOf(outcome);
      return outcome;
    } catch (error) {
      ending = { handoverNote: undefined, failure: messageOf(error) };
      throw error;
    } finally {
      await thread.end(ending);
    }
  }

  /**
   * Commits what the Stage changed, with a message from its result, unless the Stage changed git
   * itself, which fails it with the reason and leaves its work uncommitted for the user to see.
   */
  private async commitWork(
    { stage, run, stages, earlierRuns }: StageWork<"agent">,
    task: TaskRecord,
    expected: ExpectedHead,
    result: StageOutcome,
  ): Promise<StageOutcome> {
    const after = await this.stageGit.checkHead(run, task, expected);
    if (after) {
      return {
        status: "failed",
        error: `The Stage changed git itself: ${after}. Only The Office commits a Stage's work, so it stopped here without committing.`,
        handoverNote: result.handoverNote,
      };
    }
    await this.stageGit.commit(
      run,
      task,
      expected,
      stageCommitMessage(stage.name, result, acceptedIssues(stages, earlierRuns)),
    );
    return result;
  }

  private async open(
    { stage, run, stages, earlierRuns }: StageWork<"agent">,
    { card }: KnownPerson,
    task: TaskRecord,
    installProblem: string | undefined,
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
      diffSummary: await this.git.changesSoFar(task.project.id, run.taskId),
      commands,
    });
    const answered = answeredQuestion(stage, earlierRuns);
    return this.threads.open({
      taskId: run.taskId,
      roleKey: stage.role,
      stageName: stage.name,
      declared: answered ? undefined : stage.session,
      previousThreadId: previousAgentThread(stages, earlierRuns),
      record,
      work: agentStageWork(stage, {
        carried: carriedWithName(stages, run.carriedFailure),
        answered,
        installProblem,
      }),
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

  /**
   * The run's outcome when the Task's tokens so far have reached the Stage's budget (spec §2.3),
   * checked before every engine call; undefined while they haven't.
   */
  private async budgetCheck({
    stage,
    run,
    earlierRuns,
  }: StageWork<"agent">): Promise<StageOutcome | undefined> {
    const used = await this.usage.tokensSoFar(run.taskId);
    const reached = budgetReached(stage, earlierRuns, used);
    return reached && budgetOutcome(stage.name, reached);
  }

  /** The Stage's result, corrected once in the same session when it doesn't match the schema. */
  private async resultOf(work: StageWork<"agent">, thread: StageThread): Promise<StageOutcome> {
    let tokens = NO_STAGE_TOKENS;
    const counted = async (turn: StageTurn): Promise<StageTurn> => {
      tokens = addTokens(tokens, turn.tokens);
      await this.runs.saveTokens(work.run.id, tokens);
      return turn;
    };
    const first = readingOf(await counted(await thread.nextTurn()));
    if (first.valid) return first.outcome;
    // The correction is another engine call, so the budget is checked before it too.
    const reached = await this.budgetCheck(work);
    if (reached) return reached;
    const corrected = readingOf(
      await counted(
        await thread.send(
          correctionMessage(first.problems),
          `The result didn't match the Stage's result schema, so The Office asked once to correct it: ${first.problems}`,
        ),
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

/**
 * The question the Stage's Agent asked in the run before this one, with the user's answer, when
 * the Stage runs again for it.
 */
function answeredQuestion(
  stage: Stage,
  earlierRuns: readonly StageRun[],
): AnsweredQuestion | undefined {
  const asked = earlierRuns.at(-1);
  if (asked?.stageKey !== stage.key || asked.outcome?.status !== "needs-decision") return undefined;
  const answer = asked.decisions.find(({ kind }) => kind === "agent")?.answer;
  if (answer?.kind !== "answered") return undefined;
  return { question: asked.outcome.question, answer: answer.answer };
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
