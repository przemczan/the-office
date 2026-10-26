import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { READ_ONLY_GIT_COMMANDS } from "../../engine/index.js";
import {
  AGENT_STAGE_INSTRUCTIONS,
  agentStageRecord,
  agentStageWork,
  type AnsweredQuestion,
  type EarlierResult,
  type HeldRun,
} from "../domain/agent-stage-brief.js";
import { allowedCommands } from "../domain/allowed-commands.js";
import { installFailure } from "../domain/script-stage-outcome.js";
import { stageCommitMessage, type ExpectedHead } from "../domain/stage-commit.js";
import { failedInstall, installRuns } from "../domain/stage-command-run.js";
import { interruptedOutcome } from "../domain/stage-interruption.js";
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
 * Stage's work (spec §5.5). An interrupted run (spec §2.4) ends its session uncommitted instead:
 * a Stop, or The Office shutting down, stops the running turn now and discards the Stage's
 * uncommitted edits; a Pause waits for the turn to end and keeps them for the Stage to go on with.
 */
@Injectable()
export class AgentStageRunner implements StageRunner<"agent">, OnModuleInit {
  private readonly logger = new Logger(AgentStageRunner.name);

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
    if (work.interruption.requested) return this.holdWork(work, task, expected);
    // Only a restart stops the install; a Stop or a Pause during it waits for it to end.
    const installation = await this.commands.install(
      task.project.id,
      work.run.taskId,
      work.interruption.commandsSignal,
    );
    await this.runs.saveCommandRuns(work.run.id, installRuns(installation));
    if (work.interruption.requested) return this.holdWork(work, task, expected);
    const failed = failedInstall(installation);
    const thread = await this.open(work, person, task, failed && installFailure(failed));
    let ending: Ending = { handoverNote: undefined, failure: undefined };
    try {
      await this.runs.saveThread(work.run.id, thread.threadId, thread.move.move);
      const result = await this.resultOf(work, thread);
      // Before git is read, so a dev server or a watcher it started can't change the worktree.
      await thread.endSession();
      const outcome = result
        ? await this.commitWork(work, task, expected, result)
        : await this.holdWork(work, task, expected);
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
    if (after) return changedGitItself(after, result.handoverNote);
    await this.stageGit.commit(
      run,
      task,
      expected,
      stageCommitMessage(stage.name, result, acceptedIssues(stages, earlierRuns)),
    );
    return result;
  }

  /**
   * Ends an interrupted run, committing nothing: after a Stop or a restart what it left
   * uncommitted is discarded, so the Stage runs again from where it began; after a Pause it stays,
   * for the Stage to go on with. A Stage that changed git itself fails as it would have, its work left for the
   * user to see.
   */
  private async holdWork(
    { run, interruption }: StageWork<"agent">,
    task: TaskRecord,
    expected: ExpectedHead,
  ): Promise<StageOutcome> {
    const held = interruption.requested;
    if (!held) throw new Error(`Stage run ${run.id} was held, yet nothing interrupted it.`);
    const after = await this.stageGit.checkHead(run, task, expected);
    if (after) return changedGitItself(after, undefined);
    return interruptedOutcome(
      held,
      await this.stageGit.settleInterrupted(run, task, expected, held),
    );
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
    const held = heldRun(stage, earlierRuns);
    // A Stage that runs again in its own Thread continues there as the Context policy decides.
    const inItsThread = answered !== undefined || held?.threadId !== undefined;
    return this.threads.open({
      taskId: run.taskId,
      roleKey: stage.role,
      stageName: stage.name,
      declared: inItsThread ? undefined : stage.session,
      previousThreadId: previousAgentThread(
        stages,
        // A run held before its session began left no Thread: the one before it is the last.
        held && held.threadId === undefined ? earlierRuns.slice(0, -1) : earlierRuns,
      ),
      // What the user wrote that the held run's session ended before taking goes with this run.
      carryMessagesSince: held?.startedAt,
      record,
      work: agentStageWork(stage, {
        carried: carriedWithName(stages, run.carriedFailure),
        answered,
        installProblem,
        held: held && heldRunOf(held),
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

  /**
   * The Stage's result, corrected once in the same session when it doesn't match the schema;
   * undefined once the user holds the run: at the end of the turn running after a Pause, at once
   * after a Stop, which stops that turn.
   */
  private async resultOf(
    work: StageWork<"agent">,
    thread: StageThread,
  ): Promise<StageOutcome | undefined> {
    const { interruption } = work;
    const stopListening = interruption.onNow(() => {
      thread.interrupt().catch((error: unknown) => {
        this.logger.warn(`Stage run ${work.run.id}'s turn wasn't interrupted: ${messageOf(error)}`);
      });
    });
    try {
      return await this.readResult(work, thread);
    } catch (error) {
      // An engine that can't interrupt ends the session instead, so the turn read fails.
      if (interruption.now) return undefined;
      throw error;
    } finally {
      stopListening();
    }
  }

  private async readResult(
    work: StageWork<"agent">,
    thread: StageThread,
  ): Promise<StageOutcome | undefined> {
    let tokens = NO_STAGE_TOKENS;
    const counted = async (turn: StageTurn): Promise<StageTurn> => {
      tokens = addTokens(tokens, turn.tokens);
      await this.runs.saveTokens(work.run.id, tokens);
      return turn;
    };
    // Stopped while the session opened, before there was a turn to stop.
    if (work.interruption.now) return undefined;
    const first = readingOf(await counted(await thread.nextTurn()));
    if (work.interruption.requested) return undefined;
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
    if (work.interruption.requested) return undefined;
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

function changedGitItself(problem: string, handoverNote: string | undefined): StageOutcome {
  return {
    status: "failed",
    error: `The Stage changed git itself: ${problem}. Only The Office commits a Stage's work, so it stopped here without committing.`,
    handoverNote,
  };
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

/** The run before this one, when it was this Stage's and was interrupted. */
function heldRun(stage: Stage, earlierRuns: readonly StageRun[]): StageRun | undefined {
  const last = earlierRuns.at(-1);
  if (last?.stageKey !== stage.key || last.outcome?.status !== "failed") return undefined;
  return last.outcome.interrupted ? last : undefined;
}

function heldRunOf(run: StageRun): HeldRun | undefined {
  const by = run.outcome?.status === "failed" ? run.outcome.interrupted : undefined;
  if (!by) return undefined;
  const answer = run.decisions.find(({ kind }) => kind === "restart")?.answer;
  const guidance = answer?.kind === "one-more-round" ? answer.guidance : undefined;
  return guidance === undefined ? { by } : { by, guidance };
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
