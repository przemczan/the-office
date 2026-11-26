import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  EngineModels,
  EngineSessions,
  NoEngineListed,
  READ_ONLY_GIT_COMMANDS,
  RUN_PROJECT_COMMAND_TOOL,
  usageWindowWords,
} from "../../engine/index.js";
import { READ_STAGE_HISTORY_TOOL, READING_OFFICE_TOOLS } from "../../conversations/index.js";
import { narrowedPermissionProfile } from "../../people/index.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { PromptTemplates, type PromptTexts } from "../../prompt-templates/index.js";
import {
  AGENT_STAGE_THREAD_INSTRUCTIONS,
  agentStageRecord,
  agentStageWork,
  type AnsweredQuestion,
  type CarriedRound,
  earlierResults,
  type HeldRun,
  restartedSessionWork,
  workSentAgain,
} from "../domain/agent-stage-brief.js";
import { AGENT_STAGE_BRIEF_TEMPLATES } from "../domain/agent-stage-brief-templates.js";
import {
  BRIEF_COMMANDS,
  allowedCommands,
  type AllowedCommands,
} from "../domain/allowed-commands.js";
import {
  HARD_SWITCHES,
  type FollowedHardSwitches,
  type FollowedHardSwitchValue,
} from "../domain/followed-hard-switches.js";
import { installFailure } from "../domain/script-stage-outcome.js";
import { hasChoiceRows, namedChoice } from "../domain/route-choices.js";
import {
  stageCommitMessage,
  UPDATE_BRANCH_TOOL,
  withPushWords,
  type ExpectedHead,
} from "../domain/stage-commit.js";
import { failedInstall, installRuns } from "../domain/stage-command-run.js";
import { effectiveStageContextLimits } from "../domain/stage-context-limits.js";
import { closingOf, interruptedOutcome } from "../domain/stage-interruption.js";
import type { AgentStage, Stage } from "../domain/stage.js";
import { budgetOutcome, budgetReached } from "../domain/stage-budget.js";
import { staffedRole, unstaffedWords } from "../domain/stage-staffing.js";
import {
  addTokens,
  NO_STAGE_TOKENS,
  type CarriedFailure,
  type RefusedTurn,
  type StageOutcome,
  type StageRun,
  type StandInChoice,
} from "../domain/stage-run.js";
import { engineSwitched, type NamedEngine } from "../domain/stage-run-changes.js";
import {
  correctionMessage,
  RESULT_CORRECTION,
  readStageResult,
  screenshotsRefused,
  STAGE_RESULT_SCHEMA,
  type StageResultReading,
} from "../domain/stage-result.js";
import { StageAwaitsStandInChoice, StageRunThreadOpened } from "../domain/stage-run-events.js";
import { KnownPeople, type KnownPerson } from "../ports/known-people.js";
import type { HardSwitchOnCard } from "../domain/stage-permissions.js";
import { acceptedIssues, agentDecision } from "../domain/walk-decisions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { StageContextLimitDefaults } from "../ports/stage-context-limit-defaults.js";
import { RoleEngineCascade, type TaskSessionPlace } from "../ports/role-engine-cascade.js";
import {
  StageThreads,
  type AskedDecision,
  type StageSessionAhead,
  type StageThread,
  type StageThreadRequest,
  type StageTurn,
} from "../ports/stage-threads.js";
import { TaskCommands } from "../ports/task-commands.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
import { TaskScreenshots } from "../ports/task-screenshots.js";
import { TaskUsage } from "../ports/task-usage.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { ResolveStageGit } from "./resolve-stage-git.js";
import { StageCommandRuns } from "./stage-command-runs.js";
import { StageRunWaits } from "./stage-run-waits.js";
import { StageGit } from "./stage-git.js";
import { CHOOSE_ROUTE_TOOL } from "./stage-route-choices.js";
import { STAGE_STAND_IN_NEEDS } from "./stand-in-choices.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/**
 * The Office tools of an Agent Stage's session (spec §6): it reads every record and Attachment, its
 * own Task's and those of the Tasks, Idea and Initiative it is linked to, asks the user with a
 * Decision, consults a person (in tier 1 the user answers in their place), attaches a file or a link to the Task, writes
 * the Task's commit message (`write_commit_message`, Work's), changes the Project's everyday
 * settings (`change_project_settings`, Conversations'), asks The Office to update the Task's
 * branch from the base, runs the Project's commands where they run (`StageProjectCommands`), and
 * reads the Stage history, an earlier run's whole outputs and Stage Thread too, so a later Stage
 * doesn't repeat a failed approach, and proposes a Bug Task for an issue outside its Task
 * (`propose_bug_task`, Conversations'), never creating a Task itself. Never `read_threads`: it reads Thread messages only through a
 * run's Stage Thread. The names are the tools' own, which Conversations, Work and Pipelines
 * register. A session's person gets each only as their Authority rules it, and a call on another
 * Task than the Stage's is refused (spec 5.4.1).
 */
export const AGENT_STAGE_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  READ_STAGE_HISTORY_TOOL,
  "open_decision",
  "consult",
  "attach_file",
  "attach_link",
  "write_commit_message",
  "change_project_settings",
  UPDATE_BRANCH_TOOL,
  RUN_PROJECT_COMMAND_TOOL,
  "propose_bug_task",
] as const;

type Ending = Parameters<StageThread["end"]>[0];

/**
 * What reading the Stage's result came to: its outcome; the run held by the user or the alarm; or
 * the run held as the engine refused a turn for a used-up usage window.
 */
type ResultReading =
  | { readonly kind: "result"; readonly outcome: StageOutcome }
  | { readonly kind: "held" }
  | { readonly kind: "refused"; readonly refused: RefusedTurn };

/**
 * The engine the Stage's session runs on as the run goes on, which a switch to a Stand-in Engine
 * moves, by its id and name, and the cascade's engine it runs for, which stays.
 */
interface RunningEngine {
  engineId: string;
  engineName: string;
  readonly cascade: NamedEngine;
  /** The Project and the Task the session is about, whose Stand-in Engine list applies. */
  readonly place: TaskSessionPlace;
}

/** What a refused turn's switch works on: the run, its Stage Thread, and the engine it runs on. */
interface OnStandIns {
  readonly work: StageWork<"agent">;
  readonly thread: StageThread;
  readonly running: RunningEngine;
}

/**
 * What came after a refused turn: the session went on on a Stand-in Engine; the run is held, with
 * the Stand-in Engine that waits for the user's choice, if one does; or the budget was reached.
 */
type AfterRefusal =
  | { readonly kind: "switched" }
  | { readonly kind: "hold"; readonly standInChoice?: StandInChoice }
  | { readonly kind: "result"; readonly outcome: StageOutcome };

const HOLD: AfterRefusal = { kind: "hold" };

/**
 * What reading a Stage's result needs beside its run: how many Definition of Done statements the
 * Task has, and the Brief of a fresh session, with the Handover note it goes on from.
 */
interface ReadingTheResult {
  readonly statementCount: number;
  readonly freshSession: (handoverNote: string | undefined) => Promise<FreshSession>;
}

/** What a Stage's fresh session is briefed with: the Task's record, then its work. */
interface FreshSession {
  readonly record: string;
  readonly work: string;
}

/** Why the refused message goes again, as the Stage Thread logs it. */
const SENT_AGAIN =
  "The engine refused the turn for its used-up usage window, so The Office sent it again on the Stand-in Engine.";

/**
 * Runs Agent Stages (spec §2.3): the person who fills the Stage's Role works it in its Stage Thread,
 * in the session the Context policy gives it with the Stage's declared session, briefed from the
 * record, with the Project's dependencies installed first. Its result is read against the result
 * schema, corrected once in the same session when it doesn't match (research §6) or lists
 * screenshots that can't be attached, and becomes the run's outcome with its Handover note; the
 * screenshots it lists are attached to the Task (research §8). Then The Office
 * ends the session with what it left running, checks git is where it left it, and commits the
 * Stage's work (spec §5.5); a Stage with Merge the base first has The Office's merge of the base
 * around the Agent's turn (`ResolveStageGit`). An interrupted run (spec §2.4) ends its session
 * uncommitted instead: a Stop stops the running turn now and discards the Stage's uncommitted edits; The Office
 * shutting down stops it now too but keeps them, and a Pause waits for the turn to end and keeps
 * them, for the Stage to go on with.
 * A turn the engine refuses for a used-up usage window, its first or the correction, moves the
 * session to the first Stand-in Engine with room, which is sent the message again in the same run
 * (spec 5.4). With none, or one that waits for the user's choice as the context is large, it holds
 * the run as a Pause does (spec 2.3): no correction follows, the Task is paused until the window
 * resets, and the Stage is sent the refused message again as it resumes.
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
    private readonly resolveGit: ResolveStageGit,
    private readonly commands: TaskCommands,
    private readonly runs: StageRunRepository,
    private readonly usage: TaskUsage,
    private readonly screenshots: TaskScreenshots,
    private readonly engineModels: EngineModels,
    private readonly events: EventBus,
    private readonly waits: StageRunWaits,
    private readonly commandRuns: StageCommandRuns,
    private readonly startedTasks: StartedTasks,
    private readonly library: PipelineLibrary,
    private readonly engineSessions: EngineSessions,
    private readonly promptTemplates: PromptTemplates,
    private readonly contextLimitDefaults: StageContextLimitDefaults,
    private readonly cascade: RoleEngineCascade,
  ) {}

  onModuleInit(): void {
    this.runners.register("agent", this);
  }

  async run(work: StageWork<"agent">): Promise<StageOutcome> {
    const { stage } = work;
    const roleKey = staffedRole(stage);
    if (roleKey === undefined) return { status: "failed", error: unstaffedWords(stage) };
    const person = await this.people.find(roleKey);
    if (!person) {
      return {
        status: "failed",
        error: `Nobody fills the Role "${roleKey}" this Stage needs: hire them on People.`,
      };
    }
    if (await this.noEngineListed()) {
      return { status: "failed", error: new NoEngineListed().message };
    }
    // Before the session's first engine call; a budget reached leaves git and the worktree alone.
    const reached = await this.budgetCheck(work);
    if (reached) return reached;
    const task = await this.records.read(work.run.taskId);
    const { expected, refusal, branchNews } = await this.stageGit.start(work, task);
    if (refusal) return refusal;
    if (work.interruption.requested) return this.holdWork(work, task, expected);
    const merge = work.stage.mergeBaseFirst
      ? await this.resolveGit.begin(work, task, expected)
      : undefined;
    if (merge?.kind === "ended") return merge.outcome;
    // The merge's section comes on top of the Stage's own brief.
    const brief = [work.stage.brief, merge?.brief, branchNews]
      .filter((part) => part !== undefined && part !== "")
      .join("\n\n");
    return this.work(
      { ...work, stage: { ...work.stage, brief } },
      person,
      task,
      merge?.expected ?? expected,
      merge?.merging ?? false,
    );
  }

  /**
   * The Agent's turn: the Project's dependencies installed, the Stage Thread opened and its result
   * read, then the work committed, or the base's merge when `merging`.
   */
  private async work(
    work: StageWork<"agent">,
    person: KnownPerson,
    task: TaskRecord,
    expected: ExpectedHead,
    merging: boolean,
  ): Promise<StageOutcome> {
    // Only a restart stops the install; a Stop or a Pause during it waits for it to end.
    const installation = await this.commands.install(task.project.id, work.run.taskId, {
      signal: work.interruption.commandsSignal,
      wait: this.waits.of(work.run),
    });
    await this.runs.saveCommandRuns(work.run.id, installRuns(installation));
    if (work.interruption.requested) return this.holdWork(work, task, expected);
    const failed = failedInstall(installation);
    const installProblem = failed && installFailure(failed);
    const thread = await this.open(work, person, task, installProblem);
    this.commandRuns.begin(work.run.id, work.interruption.commandsSignal);
    let ending: Ending = { handoverNote: undefined, closing: undefined };
    try {
      const { threadId, move, engine, model, standInFor } = thread;
      // An engine removed since its session started keeps its id as its name.
      const engineName = (await this.engineModels.find(engine))?.name ?? engine;
      await this.runs.saveThread(work.run.id, {
        threadId,
        session: move.move,
        engineId: engine,
        engineName,
        model,
        standInFor: standInFor && {
          engineId: standInFor.engineId,
          engineName: standInFor.engineName,
          reason: standInFor.reason,
        },
      });
      await this.events.publish(
        new StageRunThreadOpened(work.run.taskId, work.run.id, work.run.stageKey),
      );
      const running: RunningEngine = {
        engineId: engine,
        engineName,
        cascade: cascadeEngineOf(task, thread, engineName),
        place: { projectId: task.project.id, taskId: work.run.taskId },
      };
      const reading = await this.resultOf(work, thread, running, {
        statementCount: task.definitionOfDone.length,
        freshSession: (handoverNote) =>
          this.freshSessionOf(work, person, installProblem, handoverNote),
      });
      // A held run keeps it too, so its answer waits for the user's Resume.
      const asked = await thread.askedDecision();
      if (asked) await this.keep(work, asked);
      // Before git is read, so a dev server or a watcher it started, or a command it ran through
      // an Office tool, can't change the worktree.
      await this.commandRuns.end(work.run.id);
      await thread.endSession();
      const after = await this.stageGit.afterTurn(work.run, expected);
      const outcome =
        reading.kind === "result"
          ? await this.commitWork(work, task, after, reading.outcome, merging)
          : await this.holdWork(
              work,
              task,
              after,
              reading.kind === "refused" ? reading.refused : undefined,
            );
      ending = endingOf(outcome);
      return outcome;
    } catch (error) {
      ending = { handoverNote: undefined, closing: { kind: "failure", reason: messageOf(error) } };
      throw error;
    } finally {
      await this.commandRuns.end(work.run.id);
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
    merging: boolean,
  ): Promise<StageOutcome> {
    const after = await this.stageGit.checkHead(run, task, expected);
    if (after) return changedGitItself(after, result.handoverNote);
    // A merge left by the Agent's own branch update ends as Merge the base first's does.
    if (merging || (await this.git.mergeInProgress(task.project.id, run.taskId))) {
      return this.resolveGit.finish(run, task, expected, result);
    }
    const pushFailed = await this.stageGit.commit(
      run,
      task,
      expected,
      stageCommitMessage(stage.name, task.title, result, acceptedIssues(stages, earlierRuns)),
    );
    return withPushWords(result, pushFailed);
  }

  /**
   * Ends an interrupted run, committing nothing: after a Stop what it left uncommitted is
   * discarded, so the Stage runs again from where it began; after a Pause, the fire alarm or a
   * restart it stays, for the Stage to go on with, even when a shutdown cut its turn short. A Stage that changed git
   * itself fails as it would have, its work left for the user to see.
   */
  private async holdWork(
    { run, interruption }: StageWork<"agent">,
    task: TaskRecord,
    expected: ExpectedHead,
    refused?: RefusedTurn,
  ): Promise<StageOutcome> {
    const held = interruption.requested;
    if (!held) throw new Error(`Stage run ${run.id} was held, yet nothing interrupted it.`);
    const after = await this.stageGit.checkHead(run, task, expected);
    if (after) return changedGitItself(after, undefined);
    const discarded = await this.stageGit.settleInterrupted(run, task, expected, held);
    return interruptedOutcome(held, discarded, {
      cutShortBy: interruption.cutShortBy,
      refused,
      heldByUser: interruption.heldByUser,
    });
  }

  private async open(
    stageWork: StageWork<"agent">,
    person: KnownPerson,
    task: TaskRecord,
    installProblem: string | undefined,
  ): Promise<StageThread> {
    const { stage, run, stages, earlierRuns } = stageWork;
    const { prompts, profile, commands, record, work } = await this.briefOf(
      stageWork,
      person,
      task,
      installProblem,
    );
    const held = heldRun(stage, earlierRuns);
    return this.threads.open({
      taskId: run.taskId,
      projectId: task.project.id,
      roleKey: workingRole(stage),
      stageName: stage.name,
      initiativeId: task.initiativeId,
      stageRun: run.number,
      pipelineName: await this.pipelineNameOf(run.taskId),
      projectName: task.project.name,
      effort: stage.effort,
      ...stageSessionOf(stage, stages, earlierRuns),
      // What the user wrote that the held run's session ended before taking goes with this run.
      carryMessagesSince: held?.startedAt,
      record,
      work,
      folder: task.worktree.path,
      environment: task.worktree.environment,
      useProjectSkills: task.project.useProjectSkills,
      projectSkillsOff: task.project.projectSkillsOff,
      session: {
        instructions: prompts.render(AGENT_STAGE_THREAD_INSTRUCTIONS, {}),
        profile: { ...profile, run: commands.permission },
        // choose_route only for a Stage whose Agent chooses its route (spec §2.3).
        officeTools: hasChoiceRows(stage.key, stages)
          ? [...AGENT_STAGE_OFFICE_TOOLS, CHOOSE_ROUTE_TOOL]
          : AGENT_STAGE_OFFICE_TOOLS,
        outputSchema: STAGE_RESULT_SCHEMA,
      },
      engineStandIns: task.engineStandIns,
      contextLimits: effectiveStageContextLimits(
        stage.contextLimits,
        await this.contextLimitDefaults.stageContextLimits(),
      ),
    });
  }

  /**
   * What a new session of the Stage is briefed with: the Task's record as it reads now, naming the
   * commands the narrowed profile lets the Agent run, and the Stage's work. A run's first session
   * and the fresh one it goes on in past a context limit read it alike.
   */
  private async briefOf(
    { stage, run, stages, earlierRuns }: StageWork<"agent">,
    { card, hardSwitches, mcpToolDefault }: KnownPerson,
    task: TaskRecord,
    installProblem: string | undefined,
    // A fresh session's Handover section names the run's choice as it stands now instead.
    namesHeldChoice = true,
  ): Promise<{
    readonly prompts: PromptTexts;
    readonly profile: ReturnType<typeof narrowedPermissionProfile>;
    readonly commands: AllowedCommands;
    readonly record: string;
    readonly work: string;
  }> {
    const profile = narrowedPermissionProfile(
      card.permissionProfile,
      stage.permissions,
      mcpToolDefault,
    );
    const prompts = await this.promptTexts();
    const commands = allowedCommands(
      prompts,
      profile.run,
      task.project.commands,
      stage.permissions?.commands,
      READ_ONLY_GIT_COMMANDS,
    );
    const answered = answeredQuestion(stage, earlierRuns);
    const held = heldRun(stage, earlierRuns);
    return {
      prompts,
      profile,
      commands,
      record: await this.recordOf(
        prompts,
        run.taskId,
        hardSwitches,
        commands,
        task,
        stages,
        earlierRuns,
      ),
      work: agentStageWork(prompts, stage, {
        carried: await this.carriedRound(stages, run.carriedFailure),
        sentBack: run.sentBack && {
          ...run.sentBack,
          gateName: stageOf(stages, run.sentBack.gateKey)?.name ?? run.sentBack.gateKey,
        },
        ...(run.restarted && { restarted: run.restarted }),
        answered,
        installProblem,
        held: held && heldRunOf(namesHeldChoice ? held : { ...held, choice: undefined }, stages),
        pipeline: {
          stages,
          commands: task.project.commands,
          roleTitle: (roleKey) => this.people.roleTitle(roleKey),
          earlierRuns,
        },
        commitMessage: {
          ...task.commitMessage,
          landsOn: landsOn(task),
          changesFrom: await this.git.changeBases(task.project.id, run.taskId),
        },
      }),
    };
  }

  /**
   * What the fresh session the Stage goes on in past a context limit (spec §2.5) is briefed with:
   * the record read again, so "What changed so far" and the earlier results are current, then the
   * earlier session's Handover note, or that it wrote none, and the Stage's work.
   */
  private async freshSessionOf(
    work: StageWork<"agent">,
    person: KnownPerson,
    installProblem: string | undefined,
    handoverNote: string | undefined,
  ): Promise<FreshSession> {
    const task = await this.records.read(work.run.taskId);
    const brief = await this.briefOf(work, person, task, installProblem, false);
    // The route the earlier session chose stands, saved on the run as it chose (spec §2.3).
    const { id } = work.run;
    const choice = (await this.runs.list(work.run.taskId)).find((run) => run.id === id)?.choice;
    return {
      record: brief.record,
      work: restartedSessionWork(brief.prompts, {
        work: brief.work,
        handoverNote,
        ...(choice && { choice: namedChoice(work.stages, choice) }),
      }),
    };
  }

  /**
   * The texts of the Prompt templates the Brief, the Stage's message, the Stage Thread and the
   * correction render.
   */
  private promptTexts(): Promise<PromptTexts> {
    return this.promptTemplates.textsOf([
      AGENT_STAGE_THREAD_INSTRUCTIONS,
      BRIEF_COMMANDS,
      HARD_SWITCHES,
      RESULT_CORRECTION,
      ...AGENT_STAGE_BRIEF_TEMPLATES,
    ]);
  }

  /** The name of the Pipeline the Task follows, for its telemetry; its id once it is gone. */
  private async pipelineNameOf(taskId: string): Promise<string> {
    const pipelineId = (await this.startedTasks.find(taskId))?.pipelineId;
    if (pipelineId === undefined) return "";
    return (await this.library.read(pipelineId))?.name ?? pipelineId;
  }

  /**
   * What the Stage's session would be were it to begin now, decided as `open` decides it: for what
   * the all clear shows will resume (spec §2.8). Undefined when nobody fills the Stage's Role, or
   * no engine is listed.
   */
  async sessionAhead(
    taskId: string,
    { stage, stages, earlierRuns }: Pick<StageWork<"agent">, "stage" | "stages" | "earlierRuns">,
  ): Promise<StageSessionAhead | undefined> {
    const roleKey = staffedRole(stage);
    const person = roleKey === undefined ? undefined : await this.people.find(roleKey);
    if (roleKey === undefined || !person || (await this.noEngineListed())) return undefined;
    const task = await this.records.read(taskId);
    const { run } = narrowedPermissionProfile(
      person.card.permissionProfile,
      stage.permissions,
      person.mcpToolDefault,
    );
    const prompts = await this.promptTexts();
    const commands = allowedCommands(
      prompts,
      run,
      task.project.commands,
      stage.permissions?.commands,
      READ_ONLY_GIT_COMMANDS,
    );
    return this.threads.sessionAhead({
      taskId,
      projectId: task.project.id,
      roleKey,
      ...stageSessionOf(stage, stages, earlierRuns),
      record: await this.recordOf(
        prompts,
        taskId,
        person.hardSwitches,
        commands,
        task,
        stages,
        earlierRuns,
      ),
      engineStandIns: task.engineStandIns,
    });
  }

  /** The only engine removed: no session starts until one is added (spec §5.4). */
  private async noEngineListed(): Promise<boolean> {
    return (await this.engineModels.engines()).length === 0;
  }

  /** The Task's record a new session of the Stage's is briefed with, naming the `commands` it may run. */
  private async recordOf(
    prompts: PromptTexts,
    taskId: string,
    hardSwitches: KnownPerson["hardSwitches"],
    commands: AllowedCommands,
    task: TaskRecord,
    stages: readonly Stage[],
    earlierRuns: readonly StageRun[],
  ): Promise<string> {
    return agentStageRecord(prompts, {
      task: {
        title: task.title,
        descriptionSection: task.descriptionSection,
        plan: task.plan,
        definitionOfDone: task.definitionOfDone,
        commitMessage: task.commitMessage,
        attachmentLines: task.attachmentLines,
        linkedRecordsSection: task.linkedRecordsSection,
        whoAskedSection: task.whoAskedSection,
        connectedDeviceLines: task.connectedDeviceLines,
        projectName: task.project.name,
        baseBranch: task.project.baseBranch,
        initiativeBranch: task.initiativeBranch,
        publishingTask: task.publishingTask,
        publishingMode: task.project.publishingMode,
        worktree: task.worktree,
      },
      earlier: earlierResults(stages, earlierRuns),
      diffSummary: await this.git.changesSoFar(task.project.id, taskId),
      commands,
      hardSwitches: this.followedHardSwitches(hardSwitches),
    });
  }

  /**
   * The failure the run carries, with its Stage's name and, for guidance a Consultant gave, who
   * they are: by name and title, or the Role's title alone once nobody fills it.
   */
  private async carriedRound(
    stages: readonly Stage[],
    carried: CarriedFailure | undefined,
  ): Promise<CarriedRound | undefined> {
    if (!carried) return undefined;
    const stageName = stageOf(stages, carried.stageKey)?.name ?? carried.stageKey;
    if (carried.guidedBy === undefined) return { ...carried, stageName };
    const title = this.people.roleTitle(carried.guidedBy);
    const name = (await this.people.find(carried.guidedBy))?.card.name;
    return { ...carried, stageName, guide: name ? `${name} (${title})` : `the ${title}` };
  }

  /**
   * The followed Hard switches, the Run installs and Publish outside the Pipeline groups of the
   * person's Authority, with whom a Consult value names by its Role's title.
   */
  private followedHardSwitches(onCard: KnownPerson["hardSwitches"]): FollowedHardSwitches {
    const asTheAgentReadsIt = (value: HardSwitchOnCard): FollowedHardSwitchValue =>
      value.kind === "consult"
        ? { kind: "consult", person: this.people.roleTitle(value.role) }
        : value;
    return {
      runInstalls: asTheAgentReadsIt(onCard.runInstalls),
      publishOutsideThePipeline: asTheAgentReadsIt(onCard.publishOutsideThePipeline),
    };
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
    const used = await this.usage.budgetTokensSoFar(run.taskId);
    const reached = budgetReached(stage, earlierRuns, used);
    return reached && budgetOutcome(stage.name, reached);
  }

  /**
   * The Stage's result, corrected once in the same session when it doesn't match the schema; held
   * once the user holds the run: at the end of the turn running after a Pause, at once after a
   * Stop, which stops that turn; or refused, once the engine refuses a turn for a used-up window
   * and no Stand-in Engine takes the session over.
   */
  private async resultOf(
    work: StageWork<"agent">,
    thread: StageThread,
    running: RunningEngine,
    reading: ReadingTheResult,
  ): Promise<ResultReading> {
    const { interruption } = work;
    const stopListening = interruption.onNow(() => {
      thread.interrupt().catch((error: unknown) => {
        this.logger.warn(`Stage run ${work.run.id}'s turn wasn't interrupted: ${messageOf(error)}`);
      });
    });
    try {
      return await this.readResult(work, thread, running, reading);
    } catch (error) {
      // An engine that can't interrupt ends the session instead, so the turn read fails.
      if (interruption.now) return { kind: "held" };
      throw error;
    } finally {
      stopListening();
    }
  }

  /**
   * Reads the Stage's result, session after session: past a context limit (spec §2.5) the session
   * hands over with its Handover note (`handing_over`), or, at the hard limit, ends its turn with no
   * result, and the Stage goes on in a fresh session of the same Thread and run, briefed again with
   * the note; its tokens and context keep adding up on the run.
   */
  private async readResult(
    work: StageWork<"agent">,
    thread: StageThread,
    running: RunningEngine,
    { statementCount, freshSession }: ReadingTheResult,
  ): Promise<ResultReading> {
    const prompts = await this.promptTexts();
    let tokens = NO_STAGE_TOKENS;
    const counted = async (turn: StageTurn): Promise<StageTurn> => {
      tokens = addTokens(tokens, turn.tokens);
      await this.runs.saveTokens(work.run.id, tokens);
      if (turn.context) await this.runs.saveContext(work.run.id, turn.context);
      return turn;
    };
    const resultIn = async (turn: StageTurn): Promise<StageResultReading> =>
      this.withScreenshots(
        work,
        readingOf(
          turn,
          await thread.askedDecision(),
          statementCount,
          thread.contextLimitPassed() !== undefined,
        ),
      );
    // Stopped while the session opened, before there was a turn to stop.
    if (work.interruption.now) return { kind: "held" };
    // A session the Stage began holds nothing but the refused work; one it went on in stays.
    let workMessage: Pick<RefusedTurn, "message" | "sessionLeft"> = {
      message: "work",
      sessionLeft: thread.move.move === "resume",
    };
    let sendWorkAgain = (): Promise<StageTurn> =>
      thread.send(workSentAgain(prompts, workMessage), SENT_AGAIN);
    for (;;) {
      const firstTurn = await this.throughRefusals(
        { work, thread, running },
        await counted(await thread.nextTurn()),
        workMessage,
        async () => counted(await sendWorkAgain()),
      );
      if ("reading" in firstTurn) return firstTurn.reading;
      if (work.interruption.requested) return { kind: "held" };
      const first = await resultIn(firstTurn.turn);
      let handover = handoverOf(first, thread);
      if (first.valid && first.handingOver === undefined) {
        return { kind: "result", outcome: first.outcome };
      }
      if (!first.valid && handover === undefined) {
        // The correction is another engine call, so the budget is checked before it too.
        const reached = await this.budgetCheck(work);
        if (reached) return { kind: "result", outcome: reached };
        const sendCorrection = async (why: string) =>
          counted(await thread.send(correctionMessage(prompts, first.problems), why));
        const correctedTurn = await this.throughRefusals(
          { work, thread, running },
          await sendCorrection(
            `The result didn't match the Stage's result schema, so The Office asked once to correct it: ${first.problems}`,
          ),
          { message: "correction", problems: first.problems, sessionLeft: true },
          () => sendCorrection(SENT_AGAIN),
        );
        if ("reading" in correctedTurn) return correctedTurn.reading;
        if (work.interruption.requested) return { kind: "held" };
        const corrected = await resultIn(correctedTurn.turn);
        if (corrected.valid && corrected.handingOver === undefined) {
          return { kind: "result", outcome: corrected.outcome };
        }
        handover = handoverOf(corrected, thread);
        if (!corrected.valid && handover === undefined) {
          return {
            kind: "result",
            outcome: {
              status: "failed",
              error: `The Stage's result still didn't match its schema after one correction: ${corrected.problems}`,
            },
          };
        }
      }
      if (handover === undefined) throw new Error("A handover without its Handover note.");
      // The fresh session's first turn is another engine call: a run past its budget stops here.
      const reached = await this.budgetCheck(work);
      if (reached) return { kind: "result", outcome: withHandoverNote(reached, handover.note) };
      const opening = await thread.restart(await freshSession(handover.note), handover.note);
      workMessage = { message: "work", sessionLeft: false };
      sendWorkAgain = () => thread.send(opening, SENT_AGAIN);
    }
  }

  /**
   * The turn, once the engine took it: while an engine refuses it for a used-up usage window, the
   * session goes on on the next Stand-in Engine with room and is sent `message` again there
   * (`sendAgain`), the run Running throughout (spec 5.4). Once none takes it over, the run is held
   * as `refused` holds it; a budget reached before the switch ends it as the budget does. A Pause or
   * Stop, or the fire alarm, asked while the session switched holds it on the Stand-in Engine, with
   * the refused message still to send.
   */
  private async throughRefusals(
    on: OnStandIns,
    turn: StageTurn,
    message: Pick<RefusedTurn, "message" | "problems" | "sessionLeft">,
    sendAgain: () => Promise<StageTurn>,
  ): Promise<{ readonly turn: StageTurn } | { readonly reading: ResultReading }> {
    let latest = turn;
    while (latest.usedUpWindow) {
      const usedUp = latest.usedUpWindow;
      const refusedBy = on.running.engineName;
      const after = await this.switchOrHold(on, usedUp);
      if (after.kind === "result") return { reading: after };
      if (after.kind === "hold" || on.work.interruption.requested) {
        const standInChoice = after.kind === "hold" ? after.standInChoice : undefined;
        return {
          reading: await this.refused(on, refusedBy, usedUp, message, standInChoice),
        };
      }
      latest = await sendAgain();
    }
    return { turn: latest };
  }

  /**
   * After the engine refused a turn for a used-up usage window (spec 5.4): the session goes on on
   * the first Stand-in Engine with room of the list that applies for the Task (its Project's own or
   * the Office's; none under an engine override, which holds the run with no Stand-in choice until
   * the reset), of the running engine's type so the session is carried with its model, unless
   * the user's Pause or Stop, or the fire alarm, asked to hold the run first, none has room, or the
   * session's context is over the size Settings › Engines asks first above, whose Stand-in Engine
   * the hold names for the user's choice. A switch that fails holds the run too: it is never the
   * Stage's failure.
   */
  private async switchOrHold(
    on: OnStandIns,
    usedUp: NonNullable<StageTurn["usedUpWindow"]>,
  ): Promise<AfterRefusal> {
    const { work, thread } = on;
    if (work.interruption.requested) return HOLD;
    // No engine listed any more, or an engine override (the cascade's `standIns` from "none"),
    // leaves no list to stand in from: the run holds until the reset, asking no choice.
    const standIns = (await this.cascade.engineAt(on.running.place))?.standIns.engineIds ?? [];
    const standInId = await this.engineSessions.standInFor(thread.engine, {
      standIns,
      sameEngineType: true,
      needs: STAGE_STAND_IN_NEEDS,
    });
    if (!standInId) return HOLD;
    const standIn = { engineId: standInId, model: thread.model };
    const to = {
      engineId: standInId,
      engineName: await this.engineSessions.nameOf(standInId),
    };
    const standInChoice = await this.choiceAsked(thread, to);
    if (standInChoice) return { kind: "hold", standInChoice };
    const reached = await this.budgetCheck(work);
    if (reached) return { kind: "result", outcome: reached };
    try {
      await thread.switchTo(standIn, usedUp);
    } catch (error) {
      this.logger.warn(
        `Stage run ${work.run.id}'s session couldn't go on on ${to.engineName}, so the run is held: ${messageOf(error)}`,
      );
      return HOLD;
    }
    await this.recordSwitch(on, to, usedUp);
    return { kind: "switched" };
  }

  /**
   * The user's choice the switch to `to` waits for: when the session's context is over the size
   * Settings › Engines asks first above; undefined while it isn't.
   */
  private async choiceAsked(
    thread: StageThread,
    to: NamedEngine,
  ): Promise<StandInChoice | undefined> {
    const contextTokens = thread.contextTokens();
    const { askBeforeSwitchAbove } = await this.engineModels.standIns();
    if (contextTokens <= askBeforeSwitchAbove) return undefined;
    return { ...to, contextTokens, askAbove: askBeforeSwitchAbove };
  }

  /**
   * Records the session's move to `to` on the run, with the engine it runs on now, and on the Task,
   * so its later Stages open on `to`, and tells of it.
   */
  private async recordSwitch(
    { work, running }: OnStandIns,
    to: NamedEngine,
    usedUp: NonNullable<StageTurn["usedUpWindow"]>,
  ): Promise<void> {
    const windowWords = usageWindowWords(usedUp.window);
    const { engineSwitch, standInFor, event } = engineSwitched(
      work.run,
      {
        from: { engineId: running.engineId, engineName: running.engineName },
        to,
        cascade: running.cascade,
        windowWords,
        resetsAt: usedUp.resetsAt,
      },
      new Date(),
    );
    const onItsOwn = to.engineId === running.cascade.engineId;
    await this.runs.saveEngineSwitch(work.run.id, engineSwitch, {
      ...to,
      standInFor: onItsOwn ? undefined : standInFor,
    });
    running.engineId = to.engineId;
    running.engineName = to.engineName;
    await this.startedTasks.wentOnOnStandIn(work.run.taskId, {
      engineId: running.cascade.engineId,
      engineName: running.cascade.engineName,
      standInId: to.engineId,
      standInName: to.engineName,
      reason: standInFor.reason,
      short: `${windowWords} used up`,
    });
    await this.events.publish(event);
  }

  /**
   * The engine `engineName` refused the Agent's turn for a used-up usage window (spec 2.3), and no
   * Stand-in Engine went on with it: no failure and no correction. Unless the user or the alarm holds
   * the run already, which stays, the run is held by the usage window and Work pauses the Task until
   * the window resets; either way the run's end records the refused message, which the Stage is
   * sent again as it resumes, and the Stand-in Engine that waits for the user's choice, if one does.
   * The run is asked to hold here only: Work's TaskPaused for it asks the walk nothing
   * (`StageInterpreter`).
   */
  private async refused(
    { work: { run, interruption }, thread }: OnStandIns,
    engineName: string,
    usedUp: NonNullable<StageTurn["usedUpWindow"]>,
    message: Pick<RefusedTurn, "message" | "problems" | "sessionLeft">,
    standInChoice: StandInChoice | undefined,
  ): Promise<ResultReading> {
    if (interruption.requested === undefined) {
      interruption.request("usage-window");
      await this.runs.saveHeldBy(run.id, "usage-window", undefined);
      await this.startedTasks.pauseForUsageWindow(run.taskId, {
        engineId: thread.engine,
        engineName,
        window: usedUp.window,
        resetsAt: usedUp.resetsAt,
        ...(standInChoice && { awaitsStandInChoice: true }),
      });
      if (standInChoice) {
        await this.events.publish(
          new StageAwaitsStandInChoice(
            run.taskId,
            run.id,
            run.stageKey,
            thread.threadId,
            thread.engine,
            standInChoice.engineId,
            standInChoice.contextTokens,
            usedUp.resetsAt,
          ),
        );
      }
    }
    return {
      kind: "refused",
      refused: {
        ...message,
        engineName,
        windowWords: usageWindowWords(usedUp.window),
        window: usedUp.window,
        resetsAt: usedUp.resetsAt.toISOString(),
        ...(standInChoice && { standInChoice }),
      },
    };
  }

  /**
   * Attaches the screenshots a valid result lists, exactly those (research §8); a list Work refuses
   * makes the result one to correct, so the Agent can fix it in the same session.
   */
  private async withScreenshots(
    { run, stage }: StageWork<"agent">,
    reading: StageResultReading,
  ): Promise<StageResultReading> {
    if (!reading.valid || reading.handingOver || reading.screenshots.length === 0) return reading;
    const attaching = await this.screenshots.attach(
      run.taskId,
      workingRole(stage),
      reading.screenshots,
    );
    if (attaching.kind === "attached") return reading;
    return { valid: false, problems: screenshotsRefused(attaching.problems) };
  }

  /**
   * Keeps the Decision the Agent opened with an Office tool on its run, so the walk waits on it and
   * takes its answer, and the Stage runs again with the answer (spec §9).
   */
  private async keep({ run }: StageWork<"agent">, asked: AskedDecision): Promise<void> {
    await this.runs.saveDecisions(run.id, [...run.decisions, agentDecision(asked)]);
  }
}

function readingOf(
  { output, problem }: StageTurn,
  asked: AskedDecision | undefined,
  statementCount: number,
  limitPassed: boolean,
): StageResultReading {
  if (output === undefined && !asked) {
    return { valid: false, problems: problem ?? "The turn ended without a result." };
  }
  return readStageResult(output, asked, statementCount, limitPassed);
}

/**
 * The handover a reading asks for (spec §2.5): a `handing_over` result with its Handover note, or,
 * past the hard limit, a turn with no valid result, which goes on with no note. Undefined when the
 * Stage goes on in this session: a session that passed no limit never restarts.
 */
function handoverOf(
  reading: StageResultReading,
  thread: StageThread,
): { readonly note: string | undefined } | undefined {
  if (reading.valid) {
    return reading.handingOver && { note: reading.handingOver.handoverNote };
  }
  return thread.contextLimitPassed() === "hard" ? { note: undefined } : undefined;
}

/** The outcome, keeping the Handover note of a session that handed over as it ended. */
function withHandoverNote(outcome: StageOutcome, handoverNote: string | undefined): StageOutcome {
  return handoverNote === undefined ? outcome : { ...outcome, handoverNote };
}

/**
 * The cascade's engine the session runs for: the one the Task's Start handed to the stand-in it runs
 * on, else the one the Thread says it stands in for, else its own.
 */
function cascadeEngineOf(task: TaskRecord, thread: StageThread, engineName: string): NamedEngine {
  const chosen = task.engineStandIns.find(({ standInId }) => standInId === thread.engine);
  if (chosen) return { engineId: chosen.engineId, engineName: chosen.engineName };
  if (thread.standInFor) {
    return { engineId: thread.standInFor.engineId, engineName: thread.standInFor.engineName };
  }
  return { engineId: thread.engine, engineName };
}

function changedGitItself(problem: string, handoverNote: string | undefined): StageOutcome {
  return {
    status: "failed",
    error: `The Stage changed git itself: ${problem}. Only The Office commits a Stage's work, so it stopped here without committing.`,
    handoverNote,
  };
}

function endingOf(outcome: StageOutcome): Ending {
  return { handoverNote: outcome.handoverNote, closing: closingOf(outcome) };
}

/** The Role the walk staffed the Stage with: `run` ends an unstaffed one before any of its work. */
function workingRole(stage: AgentStage): string {
  const roleKey = staffedRole(stage);
  if (roleKey === undefined) throw new Error(`Nobody was staffed to work the Stage ${stage.name}.`);
  return roleKey;
}

function stageOf(stages: readonly Stage[], key: string): Stage | undefined {
  return stages.find((stage) => stage.key === key);
}

/**
 * The ended runs before this one, with their Stages' names, in the order they ran. A Gate's are
 * left out: it did no work, and feedback it sent back has its own section.
 */
/**
 * The session the Stage asks of its Stage Thread: one that runs again in its own Thread, after its
 * Agent's question was answered or its run was held, continues there as the Context policy decides;
 * any other declares its own at the Stage boundary.
 */
function stageSessionOf(
  stage: AgentStage,
  stages: readonly Stage[],
  earlierRuns: readonly StageRun[],
): Pick<StageThreadRequest, "declared" | "previousThreadId"> {
  const held = heldRun(stage, earlierRuns);
  const heldWithASession = held !== undefined && leftASession(held);
  const inItsThread = answeredQuestion(stage, earlierRuns) !== undefined || heldWithASession;
  return {
    declared: inItsThread ? undefined : stage.session,
    previousThreadId: previousAgentThread(
      stages,
      // A run held before its session began left none: the one before it is the last, and the
      // Stage begins as it first did, with the full Brief.
      held && !heldWithASession ? earlierRuns.slice(0, -1) : earlierRuns,
    ),
  };
}

/**
 * Whether a held run left a session for the Stage to go on in: not when it was held before its
 * session began, nor when the engine refused the first turn of a session it began (spec 2.3).
 */
function leftASession({ threadId, outcome }: StageRun): boolean {
  if (threadId === undefined) return false;
  return outcome?.status !== "failed" || outcome.refused?.sessionLeft !== false;
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
  // A Restart from… ended the held run, its edits discarded: the Stage begins anew.
  if (last.restart) return undefined;
  return last.outcome.interrupted ? last : undefined;
}

function heldRunOf(
  { outcome, decisions, engineSwitches, choice }: StageRun,
  stages: readonly Stage[],
): HeldRun | undefined {
  if (outcome?.status !== "failed" || !outcome.interrupted) return undefined;
  const answer = decisions.find(({ kind }) => kind === "restart")?.answer;
  const guidance = answer?.kind === "one-more-round" ? answer.guidance : undefined;
  const chosen = engineSwitches.findLast(({ chosenBy }) => chosenBy !== undefined);
  return {
    ...(chosen?.chosenBy && {
      standInChosen: { engineName: chosen.toEngineName, chosenBy: chosen.chosenBy },
    }),
    by: outcome.interrupted,
    ...(outcome.heldByUser && { byUser: outcome.heldByUser }),
    ...(outcome.notStarted && { notStarted: true }),
    ...(outcome.cutShort && { cutShort: true }),
    ...(guidance !== undefined && { guidance }),
    ...(outcome.refused && { refused: outcome.refused }),
    ...(choice && { choice: namedChoice(stages, choice) }),
  };
}

/**
 * The question the Stage's Agent asked in the run before this one, with the user's answer, when
 * the Stage runs again for it.
 */
function answeredQuestion(
  stage: Stage,
  earlierRuns: readonly StageRun[],
): AnsweredQuestion | undefined {
  const last = earlierRuns.at(-1);
  if (last?.stageKey !== stage.key || last.restart) return undefined;
  // The run that asked ended needing the Decision, or was held with it.
  const asked = last.decisions.find((decision) => decision.kind === "agent");
  if (asked?.answer?.kind !== "answered") return undefined;
  return { question: asked.question, answer: asked.answer.answer };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The branch Publish lands the Task on: a Publishing Task's base branch, another Task's Initiative's
 * branch when it has one, or the base branch.
 */
function landsOn(task: TaskRecord): string {
  return task.publishingTask === true || task.initiativeBranch === undefined
    ? task.project.baseBranch
    : task.initiativeBranch;
}
