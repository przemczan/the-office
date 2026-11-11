import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Injectable, Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { ProposalAppliers } from "../../conversations/index.js";
import { EngineSessions, FIRST_CLAUDE_CODE_ENGINE } from "../../engine/index.js";
import { PipelineRoleSources } from "../../people/index.js";
import { TaskPaused, TaskResumed, TaskStateChanged } from "../../work/index.js";
import { KnownPeople, type KnownPerson } from "./known-people.js";
import { ProjectDefaults, type ProjectDefault } from "./project-defaults.js";
import { ProposalDrafts, type ProposedLibraryChange } from "./proposal-drafts.js";
import {
  StageDecisions,
  type OpenedStageDecision,
  type StageDecisionRequest,
} from "./stage-decisions.js";
import {
  StageThreads,
  type AskedDecision,
  type StageSessionAhead,
  type StageThread,
  type StageThreadRequest,
  type StageTurn,
} from "./stage-threads.js";
import { StageRoleEngines, type NewlyNamedStageRoles } from "./stage-role-engines.js";
import { StartedTasks, type StartedTask, type WalkTaskState } from "./started-tasks.js";
import type {
  CommandRun,
  Installation,
  MovedFiles,
  ScriptCommandRun,
  StageCommandPurpose,
  StageCommandRun,
} from "../domain/stage-command-run.js";
import type { PublishTarget } from "../domain/stage.js";
import type { AgentCommand, AgentCommandEnd } from "../domain/agent-command.js";
import type { StageWorkClosing } from "../domain/stage-interruption.js";
import type { DecisionAnswer } from "../domain/walk-decisions.js";
import {
  TaskCommands,
  type AgentCommandOptions,
  type CommandWait,
  type ScriptCommandKind,
  type ScriptCommandResult,
  type TaskCommandOptions,
} from "./task-commands.js";
import type { Publication, PullRequestText, ResolveEnd, ResolveStart } from "../domain/publish.js";
import type { BranchUpdate } from "../domain/stage-commit.js";
import {
  RunEnvironmentDefinitions,
  type RunEnvironmentDefinitionFile,
  type RunEnvironmentDefinitionWriting,
} from "./run-environment-definitions.js";
import { TaskGit, type WorktreeHead } from "./task-git.js";
import { TaskPublishing } from "./task-publishing.js";
import { TaskRecords, type TaskRecord } from "./task-records.js";
import { TaskScreenshots, type ScreenshotsAttaching } from "./task-screenshots.js";
import { TaskThreadSessions } from "./task-thread-sessions.js";
import { TaskUsage } from "./task-usage.js";

/** Run environments' check and write in memory: valid unless a test puts what the next gives. */
@Injectable()
export class RunEnvironmentDefinitionsForTests extends RunEnvironmentDefinitions {
  next: RunEnvironmentDefinitionWriting | undefined;
  /** Every write asked, in order. */
  readonly writes: { worktree: string; files: readonly RunEnvironmentDefinitionFile[] }[] = [];

  write(
    worktree: string,
    files: readonly RunEnvironmentDefinitionFile[],
  ): Promise<RunEnvironmentDefinitionWriting> {
    this.writes.push({ worktree, files });
    return Promise.resolve(
      this.next ?? { written: true, paths: files.map(({ path }) => path), service: "app" },
    );
  }
}

/** People's capability check: a test names the Roles whose engine can't work an Agent Stage. */
@Injectable()
export class StageRoleEnginesForTests extends StageRoleEngines {
  readonly incapableRoles = new Set<string>();
  /** Every question asked, in order. */
  readonly asked: NewlyNamedStageRoles[] = [];

  async newlyNamedRolesProblems(roles: NewlyNamedStageRoles): Promise<readonly string[]> {
    this.asked.push(roles);
    return roles.roleKeys
      .filter((roleKey) => this.incapableRoles.has(roleKey))
      .map((roleKey) => `The ${roleKey}'s engine can't work an Agent Stage.`);
  }
}

/** Projects' defaults in memory: a test puts the Projects it needs. */
@Injectable()
export class ProjectDefaultsForTests extends ProjectDefaults {
  readonly projects: ProjectDefault[] = [];

  async list(): Promise<readonly ProjectDefault[]> {
    return [...this.projects];
  }
}

/** Work's Tasks in memory: a test starts each one it walks. */
@Injectable()
export class StartedTasksForTests extends StartedTasks {
  private readonly tasks = new Map<string, StartedTask>();
  /** Every state the walk moved a Task to, in order. */
  readonly changes: { readonly taskId: string; readonly state: WalkTaskState }[] = [];

  /** Whether the fire alarm is on, as Work keeps it. */
  fireAlarmOn = false;

  /** Tells the application of an event Work publishes, once the test application is up. */
  announce: (event: DomainEvent) => Promise<void> = () => Promise.resolve();

  /** Puts the Task as Work would, such as In progress as it starts; not paused by the alarm. */
  put(
    taskId: string,
    task: Omit<StartedTask, "id" | "pausedByAlarm" | "projectId"> & Partial<StartedTask>,
  ): void {
    this.tasks.set(taskId, {
      pausedByAlarm: false,
      projectId: "test-project",
      ...task,
      id: taskId,
    });
  }

  async list(): Promise<readonly StartedTask[]> {
    return [...this.tasks.values()];
  }

  async read(taskId: string): Promise<StartedTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`There is no Task ${taskId}.`);
    return task;
  }

  /** As Work moves it: a Paused Task stays Paused, held by the user; TaskStateChanged tells of it. */
  async changeState(taskId: string, state: WalkTaskState): Promise<StartedTask> {
    const task = await this.read(taskId);
    if (task.state === "paused") return task;
    this.put(taskId, { ...task, state });
    this.changes.push({ taskId, state });
    if (task.state !== state) {
      await this.announce(new TaskStateChanged(taskId, task.state as WalkTaskState, state));
    }
    return this.read(taskId);
  }

  /** Each hold by The Office, with the reason its record gives, in order. */
  readonly holds: { readonly taskId: string; readonly reason: string }[] = [];

  /** As the user's Pause in Work: the state changes, then TaskPaused tells Pipelines. */
  async pause(taskId: string): Promise<StartedTask> {
    const task = await this.read(taskId);
    this.put(taskId, { ...task, state: "paused" });
    await this.announce(new TaskPaused(taskId, task.state as "in-progress"));
    return this.read(taskId);
  }

  /** As Work holds it: paused as by the user, the reason kept for its record. */
  async hold(taskId: string, reason: string): Promise<StartedTask> {
    this.holds.push({ taskId, reason });
    return this.pause(taskId);
  }

  /** As Work sounds the alarm: a running Task is paused by it, then TaskPaused tells Pipelines. */
  async pauseForAlarm(taskId: string): Promise<StartedTask> {
    const task = await this.read(taskId);
    const from = task.state;
    if (from !== "in-progress" && from !== "waiting-on-you") return task;
    this.put(taskId, { ...task, state: "paused", pausedByAlarm: true });
    await this.announce(new TaskPaused(taskId, from, "alarm"));
    return this.read(taskId);
  }

  async holdForFireAlarm(taskId: string): Promise<boolean> {
    if (!this.fireAlarmOn) return false;
    await this.pauseForAlarm(taskId);
    return true;
  }

  async resume(taskId: string): Promise<StartedTask> {
    const task = await this.read(taskId);
    this.put(taskId, { ...task, state: "in-progress", pausedByAlarm: false });
    await this.announce(new TaskResumed(taskId));
    return this.read(taskId);
  }

  async drop(taskId: string): Promise<StartedTask> {
    const task = await this.read(taskId);
    this.put(taskId, { ...task, state: "dropped" });
    await this.announce(new TaskStateChanged(taskId, task.state as WalkTaskState, "dropped"));
    return this.read(taskId);
  }
}

/** A Task's record as Work would give it: planned, with one Attachment, in its worktree. */
export function aTaskRecord(fields: Partial<TaskRecord> = {}): TaskRecord {
  return {
    title: "Rename a device",
    descriptionSection:
      "## What the user wants, in their own words\n\nLet me name each device as I call it.",
    plan: "Add a rename dialog to the device page.",
    definitionOfDone: ["The new name shows on the list", "The rename persists"],
    attachmentLines: ["- mockup.png (image, image/png, 2048 bytes) · Attachment a-1"],
    linkedRecordsSection: undefined,
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Admin panel",
      baseBranch: "main",
      installCommand: "npm ci",
      commands: [
        { key: "build", name: "Build", commandLine: "npm run build" },
        { key: "lint", name: "Lint", commandLine: "" },
        { key: "test", name: "Test", commandLine: "npm test" },
      ],
      useProjectSkills: false,
      projectSkillsOff: [],
    },
    worktree: {
      path: "/office/worktrees/admin-panel/task",
      branch: "office/task",
      environment: { PROJECT_VARIABLE: "set" },
      screenshotsFolder: ".office/screenshots",
    },
    ...fields,
  };
}

/** Every Task has the same record unless a test puts its own. */
@Injectable()
export class TaskRecordsForTests extends TaskRecords {
  private readonly records = new Map<string, TaskRecord>();

  put(taskId: string, record: TaskRecord): void {
    this.records.set(taskId, record);
  }

  read(taskId: string): Promise<TaskRecord> {
    return Promise.resolve(this.records.get(taskId) ?? aTaskRecord());
  }
}

/** A Developer who edits and runs the Project's commands, named Ada. */
export function aPerson(name = "Ada"): KnownPerson {
  return {
    card: {
      name,
      taskLimit: 2,
      permissionProfile: { edit: true, run: "project-commands", web: false, mcpTools: {} },
      hardSwitches: {
        runInstalls: { kind: "consult", role: "devops" },
        publishOutsideThePipeline: { kind: "never" },
      },
    },
  };
}

/** People by the key of the Role they fill: Ada fills `developer` until a test changes it. */
@Injectable()
export class KnownPeopleForTests extends KnownPeople {
  readonly people = new Map<string, KnownPerson>([["developer", aPerson()]]);

  find(roleKey: string): Promise<KnownPerson | undefined> {
    return Promise.resolve(this.people.get(roleKey));
  }

  /** The names of the people let go, by the key of the Role they filled. */
  readonly letGo = new Map<string, string>();

  findLetGo(roleKey: string): Promise<{ readonly name: string } | undefined> {
    const name = this.letGo.get(roleKey);
    return Promise.resolve(name === undefined ? undefined : { name });
  }

  /** The titles of the Roles Ada's card consults, as People keeps them. */
  readonly titles = new Map<string, string>([["devops", "Devops"]]);

  roleTitle(roleKey: string): string {
    return this.titles.get(roleKey) ?? roleKey;
  }
}

/**
 * Stage Threads as a session each on the engine, which tests script: a new session every Stage,
 * started with the record and the Stage's work. Conversations' own tests cover the Context policy.
 */
@Injectable()
export class StageThreadsForTests extends StageThreads {
  /** The Task each engine session works on. */
  readonly taskOfSession = new Map<string, string>();

  taskInSession(sessionId: string): Promise<string | undefined> {
    return Promise.resolve(this.taskOfSession.get(sessionId));
  }

  /** What each Stage asked for, in order. */
  readonly requests: StageThreadRequest[] = [];
  /** What The Office sent into a Stage's session after its first turn, with why. */
  readonly sent: { readonly threadId: string; readonly text: string; readonly why: string }[] = [];
  /** The Threads whose sessions ended, in order: a session ends once. */
  readonly sessionsEnded: string[] = [];
  /** What the person does in the worktree as each turn of theirs ends, such as move HEAD. */
  whileWorking: ((request: StageThreadRequest) => void | Promise<void>) | undefined = undefined;
  /** How each Stage's work in its Thread ended. */
  readonly ended: ({ readonly threadId: string } & Parameters<StageThread["end"]>[0])[] = [];
  /** The Threads whose running turn The Office interrupted, in order. */
  readonly interrupted: string[] = [];
  /**
   * Told as The Office waits on each turn, while it runs, such as for the user to stop it. The
   * turn goes on once what it returns settles, so what a test reads there can't miss the turn.
   */
  whileTurnRuns: ((threadId: string) => void | Promise<void>) | undefined = undefined;
  /**
   * The Decision the person opens with an Office tool as each turn runs, as a test has them ask;
   * none unless one is set. It waits until the Stage's work ends.
   */
  asksInTurn: ((request: StageThreadRequest) => AskedDecision | undefined) | undefined = undefined;
  /** The Threads whose Stage The Office found left running as it started, with why it ended. */
  readonly endedLeftRunning: { readonly threadId: string; readonly closing: StageWorkClosing }[] =
    [];
  /** The Decision each Thread found left running had opened, by its Thread, as a test puts it. */
  readonly leftAsking = new Map<string, AskedDecision>();

  constructor(private readonly sessions: EngineSessions) {
    super();
  }

  /** What `sessionAhead` answers, as a test sets it: a new session, unless set. */
  ahead: StageSessionAhead = { move: "fresh", cacheWarm: false, contextTokens: 0, briefTokens: 0 };

  /** What each `sessionAhead` asked about, in order. */
  readonly askedAhead: Parameters<StageThreads["sessionAhead"]>[0][] = [];

  async sessionAhead(
    request: Parameters<StageThreads["sessionAhead"]>[0],
  ): Promise<StageSessionAhead> {
    this.askedAhead.push(request);
    return this.ahead;
  }

  async open(request: StageThreadRequest): Promise<StageThread> {
    this.requests.push(request);
    const threadId = randomUUID();
    const engine = "claude-code";
    const model = "scripted";
    const session = await this.sessions.start({
      id: randomUUID(),
      settings: {
        engineId: FIRST_CLAUDE_CODE_ENGINE.id,
        turnLabel: `Someone in the Stage ${request.stageName}`,
        folder: request.folder,
        environment: request.environment,
        model,
        effort: "low",
        instructions: request.session.instructions,
        skills: undefined,
        profile: request.session.profile,
        officeTools: [],
        mcpServers: [],
        outputSchema: request.session.outputSchema,
      },
      brief: { id: randomUUID(), text: `${request.record}\n\n${request.work}` },
    });
    const events = session.events[Symbol.asyncIterator]();
    let turnRunning = true;
    let asked: AskedDecision | undefined;
    const nextTurn = async (): Promise<StageTurn> => {
      asked ??= this.asksInTurn?.(request);
      await this.whileTurnRuns?.(threadId);
      for (;;) {
        const next = await events.next();
        if (next.done) throw new Error(`Session ${session.id} ended without a turn.`);
        const event = next.value;
        if (event.kind === "turn-ended") {
          turnRunning = false;
          await this.whileWorking?.(request);
          const problem = event.outcome === "completed" ? undefined : event.errors.join(" ");
          return { output: event.output, problem, tokens: event.usage };
        }
      }
    };
    let sessionEnded: Promise<void> | undefined;
    const endSession = (): Promise<void> => {
      sessionEnded ??= session.end().then(() => void this.sessionsEnded.push(threadId));
      return sessionEnded;
    };
    return {
      threadId,
      // A new session every Stage, as said above.
      move: { move: "fresh" },
      engine,
      model,
      nextTurn,
      askedDecision: async () => asked,
      send: (text, why) => {
        this.sent.push({ threadId, text, why });
        session.send({ id: randomUUID(), text }, "later");
        turnRunning = true;
        return nextTurn();
      },
      interrupt: async () => {
        if (!turnRunning) return;
        this.interrupted.push(threadId);
        await session.interrupt();
      },
      end: async (ending) => {
        this.ended.push({ threadId, ...ending });
        await endSession();
      },
      endSession,
    };
  }

  async endLeftRunning(
    threadId: string,
    closing: StageWorkClosing,
  ): Promise<AskedDecision | undefined> {
    this.endedLeftRunning.push({ threadId, closing });
    return this.leftAsking.get(threadId);
  }
}

/** Conversations' Decisions in memory: each one opened, by its id. */
@Injectable()
export class StageDecisionsForTests extends StageDecisions {
  readonly opened = new Map<string, StageDecisionRequest>();
  /** Answers given in Conversations, by Decision id, as a test puts them. */
  readonly answers = new Map<string, DecisionAnswer>();

  /** Who can be consulted, by the key of their Role: a Decision put to anyone else waits on the user. */
  readonly consultants = new Set<string>();

  open(request: StageDecisionRequest): Promise<OpenedStageDecision> {
    const id = randomUUID();
    this.opened.set(id, request);
    const putTo =
      request.putTo !== undefined && this.consultants.has(request.putTo)
        ? request.putTo
        : undefined;
    return Promise.resolve({ id, putTo });
  }

  answerOf(decisionId: string): Promise<DecisionAnswer | undefined> {
    return Promise.resolve(this.answers.get(decisionId));
  }

  /** The Decisions opened on the Task, in order, each with its id. */
  on(taskId: string): (StageDecisionRequest & { readonly id: string })[] {
    return [...this.opened]
      .filter(([, request]) => request.taskId === taskId)
      .map(([id, request]) => ({ ...request, id }));
  }
}

/** Conversations' count of each Task's tokens: none unless a test puts them. */
@Injectable()
export class TaskUsageForTests extends TaskUsage {
  readonly tokens = new Map<string, number>();
  /** Tells of each read, as the runner checks a budget before an engine call. */
  observe: ((taskId: string) => void) | undefined = undefined;

  budgetTokensSoFar(taskId: string): Promise<number> {
    this.observe?.(taskId);
    return Promise.resolve(this.tokens.get(taskId) ?? 0);
  }
}

/** Conversations' sessions behind the Tasks' Threads: tells of each Task whose waiting ones end. */
@Injectable()
export class TaskThreadSessionsForTests extends TaskThreadSessions {
  /** Told of every call, as it is made, so a test can see what happened before it. */
  observe: ((taskId: string) => void) | undefined = undefined;

  endWaiting(taskId: string): Promise<void> {
    this.observe?.(taskId);
    return Promise.resolve();
  }
}

/**
 * Work's attaching of the screenshots an Agent lists: every list is attached, unless a test puts
 * the problems the next lists are refused with.
 */
@Injectable()
export class TaskScreenshotsForTests extends TaskScreenshots {
  /** Every list attached, in order. */
  readonly attached: {
    readonly taskId: string;
    readonly roleKey: string;
    readonly paths: readonly string[];
  }[] = [];
  /** The problems the next lists are refused with, in order. */
  readonly refusals: (readonly string[])[] = [];

  attach(taskId: string, roleKey: string, paths: readonly string[]): Promise<ScreenshotsAttaching> {
    const problems = this.refusals.shift();
    if (problems) return Promise.resolve({ kind: "refused", problems });
    this.attached.push({ taskId, roleKey, paths });
    return Promise.resolve({ kind: "attached", names: paths });
  }
}

/** The commit every Task's worktree starts at, as planning left it. */
export const PLANNED_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/**
 * The Tasks' worktrees' git in memory: each starts on its branch from `aTaskRecord` at
 * PLANNED_COMMIT, and every commit The Office makes moves it, unless a test says nothing changed.
 */
@Injectable()
export class TaskGitForTests extends TaskGit {
  private readonly heads = new Map<string, WorktreeHead>();
  /** What each Task's worktree holds uncommitted, as an Agent's edits leave it. */
  readonly uncommitted = new Map<string, readonly string[]>();
  /** Every discard The Office made, in order, with the paths it dropped. */
  readonly discarded: { readonly taskId: string; readonly paths: readonly string[] }[] = [];
  /** Every commit The Office made, in order. */
  readonly commits: {
    readonly taskId: string;
    readonly message: string;
    readonly commit: string;
  }[] = [];
  /** The Tasks whose worktrees hold nothing to commit. */
  readonly unchanged = new Set<string>();
  /** What git says each Task's commits changed so far; undefined when a test puts nothing. */
  readonly changes = new Map<string, string>();
  /** Told of every call, as it is made, so a test can see what happened before it. */
  observe:
    | ((call: "head" | "commit" | "discard" | "changesSoFar" | "removeWorktree") => void)
    | undefined = undefined;
  /** The Tasks whose worktrees The Office removed, in order. */
  readonly removedWorktrees: string[] = [];
  /** How bringing each Task's branch to the base goes; up to date when a test puts nothing. */
  readonly branchUpdates = new Map<string, BranchUpdate>();
  /** The Tasks whose worktree holds a merge of the base left for an Agent. */
  readonly merging = new Set<string>();
  /** The Tasks whose branch moved along the base, so The Office takes the move as it is. */
  readonly movesAlongBase = new Set<string>();
  /** Set when removing a worktree fails, as a file a process holds on Windows makes it. */
  removalFailure: string | undefined = undefined;

  /** Moves the Task's HEAD, as an Agent with git of its own would. */
  move(taskId: string, head: WorktreeHead): void {
    this.heads.set(taskId, head);
  }

  updateFromBase(_projectId: string, taskId: string): Promise<BranchUpdate> {
    const update = this.branchUpdates.get(taskId) ?? { kind: "up-to-date" };
    if (update.kind === "updated")
      this.heads.set(taskId, { ...this.headOf(taskId), commit: update.commit });
    return Promise.resolve(update);
  }

  mergeInProgress(_projectId: string, taskId: string): Promise<boolean> {
    return Promise.resolve(this.merging.has(taskId));
  }

  movedAlongBase(_projectId: string, taskId: string): Promise<boolean> {
    return Promise.resolve(this.movesAlongBase.has(taskId));
  }

  head(_projectId: string, taskId: string): Promise<WorktreeHead> {
    this.observe?.("head");
    return Promise.resolve(this.headOf(taskId));
  }

  commit(_projectId: string, taskId: string, message: string): Promise<string | undefined> {
    this.observe?.("commit");
    if (this.unchanged.has(taskId)) return Promise.resolve(undefined);
    const commit = `${this.commits.length + 1}`.padStart(40, "c");
    this.commits.push({ taskId, message, commit });
    this.move(taskId, { commit, branch: this.headOf(taskId).branch });
    return Promise.resolve(commit);
  }

  discard(_projectId: string, taskId: string): Promise<readonly string[]> {
    this.observe?.("discard");
    const paths = this.uncommitted.get(taskId) ?? [];
    this.uncommitted.delete(taskId);
    this.discarded.push({ taskId, paths });
    return Promise.resolve(paths);
  }

  changesSoFar(_projectId: string, taskId: string): Promise<string | undefined> {
    this.observe?.("changesSoFar");
    return Promise.resolve(this.changes.get(taskId));
  }

  removeWorktree(_projectId: string, taskId: string): Promise<void> {
    this.observe?.("removeWorktree");
    if (this.removalFailure) return Promise.reject(new Error(this.removalFailure));
    this.removedWorktrees.push(taskId);
    return Promise.resolve();
  }

  private headOf(taskId: string): WorktreeHead {
    return (
      this.heads.get(taskId) ?? { commit: PLANNED_COMMIT, branch: aTaskRecord().worktree.branch }
    );
  }
}

/** A run of `commandLine` that ended `outcome`, printing `output`. */
export function aCommandRun(
  commandLine: string,
  outcome: CommandRun["outcome"],
  output = "",
): ScriptCommandRun {
  return {
    commandLine,
    outcome,
    exitCode: outcome === "passed" ? 0 : 1,
    durationMs: 1200,
    output,
    wholeOutput: output,
    movedFiles: undefined,
  };
}

/** A command run as a Stage run records it: its whole output is read apart from it. */
export function recordedRun(
  run: CommandRun,
  purpose: StageCommandPurpose,
  fields: { readonly movedFiles?: MovedFiles } = {},
): StageCommandRun {
  const { wholeOutput: _keptApart, ...recorded } = run;
  return { ...recorded, purpose, ...fields };
}

/**
 * The Projects' commands in memory: installs are up to date and each command passes once, unless
 * a test puts what the next installs or commands give.
 */
@Injectable()
export class TaskCommandsForTests extends TaskCommands {
  /** What the next installs give, in order. */
  readonly installations: Installation[] = [];
  /** What the next commands give, in order: each its runs. */
  readonly commandRuns: (readonly ScriptCommandRun[])[] = [];
  /** Each command's kind by its key: the starting commands', unless a test adds or removes one. */
  readonly commandKinds = new Map<string, ScriptCommandKind>([
    ["build", "build"],
    ["lint", "lint"],
    ["test", "test"],
  ]);
  /** Every command run, in order. */
  readonly ran: {
    readonly taskId: string;
    readonly key: string;
    readonly stageRunId: string;
  }[] = [];
  /** Told of every call, as it is made, so a test can see what happened before it. */
  observe: ((call: "install" | "runCommand") => void) | undefined = undefined;
  /** Set while the next command runs until its signal stops it, as a hung test run would. */
  runsUntilStopped = false;

  /**
   * Set to make the next command wait for a free run environment first: it tells the wait, then
   * runs once this resolves, or ends stopped, with nothing run, when its signal stops it.
   */
  waitsUntil: Promise<void> | undefined = undefined;

  /** What the next Agents' commands give, in order. */
  readonly agentCommandEnds: AgentCommandEnd[] = [];
  /** Every Agent's command, in order. */
  readonly agentCommands: {
    readonly taskId: string;
    readonly command: AgentCommand;
    readonly outputFile: string;
  }[] = [];
  /** Set to make every Agent's command run until its signal stops it. */
  agentCommandRunsUntilStopped = false;
  /** Told as an Agent's command that runs until stopped begins. */
  agentCommandStarted: (() => void) | undefined = undefined;

  install(): Promise<Installation> {
    this.observe?.("install");
    return Promise.resolve(this.installations.shift() ?? { kind: "up-to-date" });
  }

  async runCommand(
    _projectId: string,
    taskId: string,
    key: string,
    stageRunId: string,
    options: TaskCommandOptions,
  ): Promise<ScriptCommandResult> {
    const runs = await this.runsOf(taskId, key, stageRunId, options);
    return { kind: this.commandKinds.get(key), runs };
  }

  private async runsOf(
    taskId: string,
    key: string,
    stageRunId: string,
    { signal, wait }: TaskCommandOptions,
  ): Promise<readonly ScriptCommandRun[]> {
    this.observe?.("runCommand");
    if (this.waitsUntil) {
      const waited = await this.waitFor(this.waitsUntil, signal, wait);
      this.waitsUntil = undefined;
      if (!waited) return [aCommandRun(`npm run ${key}`, "stopped")];
    }
    this.ran.push({ taskId, key, stageRunId });
    if (this.runsUntilStopped) {
      this.runsUntilStopped = false;
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
      return [aCommandRun(`npm run ${key}`, "stopped")];
    }
    return this.commandRuns.shift() ?? [aCommandRun(`npm run ${key}`, "passed")];
  }

  /**
   * Runs an Agent's command: it gives what a test put next, else the command passed, its output
   * written to the file. While `agentCommandRunsUntilStopped`, it runs until its signal stops it,
   * as a hung test run would, and `agentCommandStarted` is told once it runs.
   */
  async runForAgent(
    _projectId: string,
    taskId: string,
    command: AgentCommand,
    { signal, outputFile }: AgentCommandOptions,
  ): Promise<AgentCommandEnd> {
    this.agentCommands.push({ taskId, command, outputFile });
    const commandLine = "key" in command ? `npm run ${command.key}` : command.commandLine;
    if (this.agentCommandRunsUntilStopped) {
      this.agentCommandStarted?.();
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
      return { kind: "ran", run: aCommandRun(commandLine, "stopped") };
    }
    const end = this.agentCommandEnds.shift() ?? {
      kind: "ran",
      run: aCommandRun(commandLine, "passed", "1 passed"),
    };
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, end.kind === "no-command" ? "" : end.run.wholeOutput);
    return end;
  }

  /** Whether the wait ended in the command's turn, not in a stop. */
  private async waitFor(
    turn: Promise<void>,
    signal: AbortSignal,
    wait: CommandWait | undefined,
  ): Promise<boolean> {
    await wait?.started();
    const stopped = new Promise<false>((resolve) => {
      if (signal.aborted) resolve(false);
      signal.addEventListener("abort", () => resolve(false), { once: true });
    });
    try {
      return await Promise.race([turn.then(() => true), stopped]);
    } finally {
      await wait?.ended();
    }
  }
}

/** The commit Resolve's merge commit is, unless a test puts another. */
export const RESOLVED_COMMIT = "5e1f0c4a9b2d8e7f6a5b4c3d2e1f0a9b8c7d6e5f";

/**
 * Publishing in memory: each Publish opens a pull request, and each Resolve's merge leaves
 * `src/index.ts` conflicted and commits as RESOLVED_COMMIT, unless a test puts what the next give.
 */
@Injectable()
export class TaskPublishingForTests extends TaskPublishing {
  /** What the next Publishes give, in order. */
  readonly publications: Publication[] = [];
  /** What the next Resolves' merges begin and end with, in order. */
  readonly resolveStarts: ResolveStart[] = [];
  readonly resolveEnds: ResolveEnd[] = [];
  /** Every Resolve call, in order, with its Task. */
  readonly resolveCalls: {
    readonly call: "start" | "finish" | "abandon";
    readonly taskId: string;
  }[] = [];
  /** Every Publish, in order, with the pull request's words. */
  readonly published: {
    readonly taskId: string;
    readonly text: PullRequestText;
    readonly target: PublishTarget;
  }[] = [];

  publish(
    _projectId: string,
    taskId: string,
    text: PullRequestText,
    target: PublishTarget,
  ): Promise<Publication> {
    this.published.push({ taskId, text, target });
    return Promise.resolve(
      this.publications.shift() ?? {
        kind: "pull-request-opened",
        branch: aTaskRecord().worktree.branch,
        url: "https://github.com/notnullsoft/admin/pull/7",
      },
    );
  }

  constructor(private readonly git: TaskGitForTests) {
    super();
  }

  startResolve(_projectId: string, taskId: string): Promise<ResolveStart> {
    this.resolveCalls.push({ call: "start", taskId });
    const start = this.resolveStarts.shift() ?? {
      kind: "conflicted",
      base: { remote: "origin", branch: "main" },
      conflictedFiles: ["src/index.ts"],
    };
    if (start.kind === "merged") this.mergedAt(taskId, start.commit);
    return Promise.resolve(start);
  }

  finishResolve(_projectId: string, taskId: string): Promise<ResolveEnd> {
    this.resolveCalls.push({ call: "finish", taskId });
    const end = this.resolveEnds.shift() ?? { kind: "resolved", commit: RESOLVED_COMMIT };
    if (end.kind === "resolved") this.mergedAt(taskId, end.commit);
    return Promise.resolve(end);
  }

  /** The merge commit moves the Task's branch, as git's would. */
  private mergedAt(taskId: string, commit: string): void {
    this.git.move(taskId, { commit, branch: aTaskRecord().worktree.branch });
  }

  abandonResolve(_projectId: string, taskId: string): Promise<void> {
    this.resolveCalls.push({ call: "abandon", taskId });
    return Promise.resolve();
  }
}

/** Conversations' Proposals: what was drafted, by session. */
@Injectable()
export class ProposalDraftsForTests extends ProposalDrafts {
  readonly drafted: { readonly sessionId: string; readonly change: ProposedLibraryChange }[] = [];

  draft(sessionId: string, change: ProposedLibraryChange): Promise<{ readonly id: string }> {
    this.drafted.push({ sessionId, change });
    return Promise.resolve({ id: randomUUID() });
  }
}

/**
 * The ports' stand-ins, the Stage Threads' sessions on the engine `imports` give, and the registry
 * of Conversations' Proposal appliers and People's of the Roles Stages name, which Pipelines fills.
 */
@Module({})
export class PipelinesPortsForTestsModule {
  static register(imports: NonNullable<ModuleMetadata["imports"]>): DynamicModule {
    const providers = [
      ProjectDefaultsForTests,
      StartedTasksForTests,
      TaskRecordsForTests,
      KnownPeopleForTests,
      StageThreadsForTests,
      StageDecisionsForTests,
      TaskGitForTests,
      TaskCommandsForTests,
      TaskPublishingForTests,
      TaskScreenshotsForTests,
      TaskUsageForTests,
      TaskThreadSessionsForTests,
      ProposalDraftsForTests,
      StageRoleEnginesForTests,
      RunEnvironmentDefinitionsForTests,
      ProposalAppliers,
      PipelineRoleSources,
    ];
    return { module: PipelinesPortsForTestsModule, imports, providers, exports: providers };
  }
}
