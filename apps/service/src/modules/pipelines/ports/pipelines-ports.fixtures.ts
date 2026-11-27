import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Injectable, Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { ProposalAppliers } from "../../conversations/index.js";
import {
  EngineSessions,
  FIRST_CLAUDE_CODE_ENGINE,
  type EngineId,
  type EngineModel,
} from "../../engine/index.js";
import {
  DUTIES,
  permissionNarrowingProblems,
  PipelineRoleSources,
  type EngineAtPlace,
  type EngineInCascade,
} from "../../people/index.js";
import {
  TaskEngineChecks,
  TaskPaused,
  TaskResumed,
  TaskStageEdits,
  TaskStartOvers,
  TaskStateChanged,
} from "../../work/index.js";
import { KnownPeople, type KnownPerson } from "./known-people.js";
import { PipelineInitiatives, type PipelineInitiative } from "./pipeline-initiatives.js";
import { ProjectDefaults, type ProjectDefault } from "./project-defaults.js";
import {
  StageDecisions,
  type OpenedStageDecision,
  type StageDecisionRequest,
} from "./stage-decisions.js";
import {
  StageThreads,
  type AskedDecision,
  type StageContextLimitPassed,
  type StageSessionAhead,
  type StageThread,
  type StageThreadRequest,
  type StageTurn,
} from "./stage-threads.js";
import {
  StageRoleEngines,
  type NewlyNamedStageRoles,
  type TaskEnginesChange,
} from "./stage-role-engines.js";
import { RoleEngineCascade, type TaskSessionPlace } from "./role-engine-cascade.js";
import { StageThreadMessages, type StageRunThreadWindow } from "./stage-thread-messages.js";
import {
  StartedTasks,
  type ResumedOrDroppedBy,
  type StartedTask,
  type TaskBlocker,
  type StandInTakingOver,
  type UsageWindowRefusal,
  type WalkTaskState,
} from "./started-tasks.js";
import type {
  CommandRun,
  Installation,
  MovedFiles,
  ScriptCommandRun,
  StageCommandPurpose,
  StageCommandRun,
} from "../domain/stage-command-run.js";
import type { StagePermissions } from "../domain/stage-permissions.js";
import type { PublishTarget } from "../domain/stage.js";
import type { AgentCommand, AgentCommandEnd } from "../domain/agent-command.js";
import type { StageWorkClosing } from "../domain/stage-interruption.js";
import type {
  GateDropReason,
  StageRunContext,
  StageRunStandIn,
  StageSessionMove,
} from "../domain/stage-run.js";
import type { DecisionAnswer } from "../domain/walk-decisions.js";
import {
  TaskCommands,
  type AgentCommandOptions,
  type CommandWait,
  type ScriptCommandKind,
  type PublishingLine,
  type ScriptCommandResult,
  type TaskCommandOptions,
} from "./task-commands.js";
import type { CommitMessage, Publication, ResolveEnd, ResolveStart } from "../domain/publish.js";
import type { BranchUpdate, PublishingBranchPush } from "../domain/stage-commit.js";
import {
  RunEnvironmentDefinitions,
  type RunEnvironmentDefinitionCommit,
  type RunEnvironmentDefinitionFile,
  type RunEnvironmentDefinitionWriting,
} from "./run-environment-definitions.js";
import { TaskConsultations, type TaskConsultation } from "./task-consultations.js";
import { TaskGit, type WorktreeHead } from "./task-git.js";
import { TaskPublishing } from "./task-publishing.js";
import { TaskRecords, type TaskRecord } from "./task-records.js";
import { TaskScreenshots, type ScreenshotsAttaching } from "./task-screenshots.js";
import { SessionPeople } from "./session-people.js";
import { TaskThreadSessions } from "./task-thread-sessions.js";
import { TaskUsage } from "./task-usage.js";
import { StageContextLimitDefaults } from "./stage-context-limit-defaults.js";
import type { ContextLimits } from "../domain/stage-context-limits.js";
import { RUN_EVERY_CALL } from "../../engine/index.fixtures.js";

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

  /** Every write and commit asked, in order. */
  readonly commits: {
    worktree: string;
    files: readonly RunEnvironmentDefinitionFile[];
    message: string;
  }[] = [];

  /** The commit a written definition is committed as. */
  commit = "4f2a9c1e0b7d3a6c5e8f9a0b1c2d3e4f5a6b7c8d";

  writeAndCommit(
    worktree: string,
    files: readonly RunEnvironmentDefinitionFile[],
    message: string,
  ): Promise<RunEnvironmentDefinitionCommit> {
    this.commits.push({ worktree, files, message });
    const writing = this.next ?? {
      written: true,
      paths: files.map(({ path }) => path),
      service: "app",
    };
    return Promise.resolve(writing.written ? { ...writing, commit: this.commit } : writing);
  }
}

/** Conversations' Consultations on Tasks: a test puts each Consultation by its session. */
@Injectable()
export class TaskConsultationsForTests extends TaskConsultations {
  readonly bySession = new Map<string, TaskConsultation>();
  /** Every line logged, in order. */
  readonly lines: { readonly threadId: string; readonly decisionId: string; text: string }[] = [];

  consultationOnTask(sessionId: string): Promise<TaskConsultation | undefined> {
    return Promise.resolve(this.bySession.get(sessionId));
  }

  logOfficeLine(threadId: string, decisionId: string, text: string): Promise<void> {
    this.lines.push({ threadId, decisionId, text });
    return Promise.resolve();
  }
}

/** People's capability check: a test names the Roles whose engine can't work an Agent Stage. */
@Injectable()
export class StageRoleEnginesForTests extends StageRoleEngines {
  readonly incapableRoles = new Set<string>();
  /** Every question asked, in order. */
  readonly asked: NewlyNamedStageRoles[] = [];
  /** Every change of Tasks' engines asked about, in order. */
  readonly changesAsked: TaskEnginesChange[] = [];

  async newlyNamedRolesProblems(roles: NewlyNamedStageRoles): Promise<readonly string[]> {
    this.asked.push(roles);
    return roles.roleKeys
      .filter((roleKey) => this.incapableRoles.has(roleKey))
      .map((roleKey) => `The ${roleKey}'s engine can't work an Agent Stage.`);
  }

  /**
   * Each Role in `incapableRoles` a moved Task names, once, in `place`; for a Task whose Pipeline
   * the change chooses, only those its Stages didn't name before.
   */
  async workLevelsChangeProblems(change: TaskEnginesChange): Promise<readonly string[]> {
    this.changesAsked.push(change);
    const roleKeys = new Set(
      change.tasks.flatMap((task) =>
        task.roleKeys.filter((roleKey) => !task.namedBefore?.roleKeys.includes(roleKey)),
      ),
    );
    return [...roleKeys]
      .filter((roleKey) => this.incapableRoles.has(roleKey))
      .map((roleKey) => `${change.place}, the ${roleKey}'s engine can't work an Agent Stage.`);
  }
}

/**
 * People's engine cascade as a test sets it: every Task on `officeDefault`'s engine unless
 * `setEngineFor` gives it another, and every Role working as `officeDefault` says unless `setFor`
 * gives the Role, on every Task or one, how it works. Every question asked is kept.
 */
@Injectable()
export class RoleEngineCascadeForTests extends RoleEngineCascade {
  officeDefault: EngineInCascade | null = {
    engineId: "claude-code",
    model: "claude-sonnet-5-5",
    level: "office",
    engineType: "claude-code",
    effort: null,
    modelLevel: "engine",
    effortLevel: "engine",
    standIns: { from: "office", engineIds: [] },
  };
  readonly asked: { readonly roleKey: string; readonly place: TaskSessionPlace }[] = [];
  readonly askedForEngine: TaskSessionPlace[] = [];
  private readonly set = new Map<string, EngineInCascade>();
  private readonly engines = new Map<string, EngineAtPlace>();

  /** The Role runs on `engine` on every Task, or on the Task `taskId` only. */
  setFor(roleKey: string, engine: EngineInCascade, taskId?: string): void {
    this.set.set(JSON.stringify([roleKey, taskId ?? null]), engine);
  }

  /** Every session about the Task `taskId` runs on `engine`. */
  setEngineFor(taskId: string, engine: EngineAtPlace): void {
    this.engines.set(taskId, engine);
  }

  async engineAt(place: TaskSessionPlace): Promise<EngineAtPlace | null> {
    this.askedForEngine.push(place);
    const set = this.engines.get(place.taskId);
    if (set) return set;
    if (this.officeDefault === null) return null;
    const { engineId, engineType, level, standIns } = this.officeDefault;
    return { engineId, engineType, engineName: "Claude Code", level, standIns };
  }

  async applying(roleKey: string, place: TaskSessionPlace): Promise<EngineInCascade | null> {
    this.asked.push({ roleKey, place });
    return (
      this.set.get(JSON.stringify([roleKey, place.taskId])) ??
      this.set.get(JSON.stringify([roleKey, null])) ??
      this.officeDefault
    );
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

/** Work's Initiatives with a Pipeline in memory: none unless a test puts some. */
@Injectable()
export class PipelineInitiativesForTests extends PipelineInitiatives {
  readonly initiatives: PipelineInitiative[] = [];

  async withPipelines(): Promise<readonly PipelineInitiative[]> {
    return [...this.initiatives];
  }
}

/** The states Work's started Tasks are in. */
const STARTED_STATES: readonly string[] = ["in-progress", "waiting-on-you", "paused"];

/** Work's Tasks in memory: a test starts each one it walks. */
@Injectable()
export class StartedTasksForTests extends StartedTasks {
  private readonly tasks = new Map<string, StartedTask>();
  /** Every state the walk moved a Task to, in order. */
  readonly changes: {
    readonly taskId: string;
    readonly state: WalkTaskState;
    /** The reason a drop at a Gate brought, when it brought one. */
    readonly dropReason?: GateDropReason;
  }[] = [];

  /** The way the fire alarm is on, as Work keeps it; undefined while it is off. */
  fireAlarmWay: "asap" | "after-stages" | "after-tasks" | undefined = undefined;

  /** Tells the application of an event Work publishes, once the test application is up. */
  announce: (event: DomainEvent) => Promise<void> = () => Promise.resolve();

  /** Puts the Task as Work would, such as In progress as it starts; not paused by the alarm. */
  put(
    taskId: string,
    task: Omit<StartedTask, "id" | "pausedBy" | "projectId"> & Partial<StartedTask>,
  ): void {
    this.tasks.set(taskId, {
      pausedBy: undefined,
      projectId: "test-project",
      ...task,
      id: taskId,
    });
  }

  async started(): Promise<readonly StartedTask[]> {
    return this.where(({ state }) => STARTED_STATES.includes(state));
  }

  async open(): Promise<readonly StartedTask[]> {
    return this.where(({ state }) => state !== "done" && state !== "dropped");
  }

  async pausedByUsageWindow(): Promise<readonly StartedTask[]> {
    return this.where(({ state, pausedBy }) => state === "paused" && pausedBy === "usage-window");
  }

  async onPipelines(pipelineIds: readonly string[]): Promise<readonly StartedTask[]> {
    return this.where(
      ({ pipelineId }) => pipelineId !== undefined && pipelineIds.includes(pipelineId),
    );
  }

  private where(matches: (task: StartedTask) => boolean): StartedTask[] {
    return [...this.tasks.values()].filter(matches);
  }

  async read(taskId: string): Promise<StartedTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`There is no Task ${taskId}.`);
    return task;
  }

  async find(taskId: string): Promise<StartedTask | undefined> {
    return this.tasks.get(taskId);
  }

  /** As Work moves it: a Paused Task stays Paused, held by the user; TaskStateChanged tells of it. */
  async changeState(
    taskId: string,
    state: WalkTaskState,
    dropReason?: GateDropReason,
  ): Promise<StartedTask> {
    const task = await this.read(taskId);
    if (task.state === "paused") return task;
    this.put(taskId, { ...task, state });
    this.changes.push(dropReason ? { taskId, state, dropReason } : { taskId, state });
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
    this.put(taskId, { ...task, state: "paused", pausedBy: "alarm" });
    await this.announce(new TaskPaused(taskId, from, "alarm"));
    return this.read(taskId);
  }

  /** Each pause by the usage window, with its refusal, in order. */
  readonly usageWindowPauses: { readonly taskId: string; readonly refusal: UsageWindowRefusal }[] =
    [];

  /** As Work pauses it by the usage window: TaskPaused tells Pipelines, which leaves the run to its runner. */
  async pauseForUsageWindow(taskId: string, refusal: UsageWindowRefusal): Promise<StartedTask> {
    const task = await this.read(taskId);
    this.usageWindowPauses.push({ taskId, refusal });
    this.put(taskId, { ...task, state: "paused", pausedBy: "usage-window" });
    await this.announce(
      new TaskPaused(taskId, task.state as "in-progress", "usage-window", refusal),
    );
    return this.read(taskId);
  }

  /** Each Stand-in Engine a running Stage went on on, in order. */
  readonly standInsTakenOver: { readonly taskId: string; readonly standIn: StandInTakingOver }[] =
    [];
  /** Told of each, as a test sets it, such as to give the Task's record the stand-in. */
  whenWentOnOnStandIn: ((taskId: string, standIn: StandInTakingOver) => void) | undefined =
    undefined;

  async wentOnOnStandIn(taskId: string, standIn: StandInTakingOver): Promise<void> {
    this.standInsTakenOver.push({ taskId, standIn });
    this.whenWentOnOnStandIn?.(taskId, standIn);
  }

  async holdForFireAlarm(taskId: string): Promise<boolean> {
    if (this.fireAlarmWay === undefined || this.fireAlarmWay === "after-tasks") return false;
    await this.pauseForAlarm(taskId);
    return true;
  }

  /** What `resume` fails with for each Task, as a test sets it: it resumes, unless set. */
  readonly resumeFails = new Map<string, Error>();

  async resume(taskId: string): Promise<StartedTask> {
    const fails = this.resumeFails.get(taskId);
    if (fails) throw fails;
    const task = await this.read(taskId);
    this.put(taskId, { ...task, state: "in-progress", pausedBy: undefined });
    await this.announce(new TaskResumed(taskId));
    return this.read(taskId);
  }

  /** Why each Task can't be restarted, when a test says it can't. */
  readonly restartRefusals = new Map<string, readonly string[]>();
  /** Every Restart from…, with the Stage's name and who, in order. */
  readonly restarts: {
    readonly taskId: string;
    readonly stageName: string;
    readonly by: { readonly userId: string; readonly name: string };
  }[] = [];

  async restartProblems(taskId: string): Promise<readonly string[]> {
    const refused = this.restartRefusals.get(taskId);
    if (refused) return refused;
    const task = await this.read(taskId);
    return task.state === "paused" && task.pausedBy === undefined
      ? []
      : ["Only a Task the user paused or stopped can be restarted."];
  }

  async restart(
    taskId: string,
    restart: {
      readonly stageName: string;
      readonly by: { readonly userId: string; readonly name: string };
    },
  ): Promise<StartedTask> {
    this.restarts.push({ taskId, ...restart });
    const task = await this.read(taskId);
    this.put(taskId, { ...task, state: "in-progress", pausedBy: undefined });
    await this.announce(new TaskResumed(taskId));
    return this.read(taskId);
  }

  /** Each Drop, with who it is recorded by, in order. */
  readonly drops: { readonly taskId: string; readonly by: ResumedOrDroppedBy }[] = [];

  dropAsAnswered(
    taskId: string,
    { by }: { readonly decisionId: string; readonly by: ResumedOrDroppedBy },
  ): Promise<StartedTask> {
    return this.drop(taskId, by);
  }

  /** Drops the Task as Work does, for a test's Drop from outside Pipelines too. */
  async drop(taskId: string, by: ResumedOrDroppedBy): Promise<StartedTask> {
    this.drops.push({ taskId, by });
    const task = await this.read(taskId);
    this.put(taskId, { ...task, state: "dropped" });
    await this.announce(new TaskStateChanged(taskId, task.state as WalkTaskState, "dropped"));
    return this.read(taskId);
  }

  /** The blockers a test says still hold each Task back; none unless it says so. */
  readonly blockers = new Map<string, readonly TaskBlocker[]>();

  async waitingFor(taskId: string): Promise<readonly TaskBlocker[]> {
    return this.blockers.get(taskId) ?? [];
  }

  /** The Tasks whose commit message Publish landed, in order. */
  readonly commitMessagesPublished: string[] = [];

  async markCommitMessagePublished(taskId: string): Promise<void> {
    this.commitMessagesPublished.push(taskId);
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
    initiativeId: undefined,
    commitMessage: {
      text: "Rename a device\n\nAdds a rename dialog to the device page.",
      written: true,
    },
    attachmentLines: ["- mockup.png (image, image/png, 2048 bytes) · Attachment a-1"],
    linkedRecordsSection: undefined,
    connectedDeviceLines: [],
    whoAskedSection:
      "## Who asked\n\nThe Task was created by the user Ann Lee and started by the user Ben Ito.",
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
    engineStandIns: [],
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
    },
    hardSwitches: {
      runInstalls: { kind: "consult", role: "devops" },
      publishOutsideThePipeline: { kind: "never" },
    },
    mcpToolDefault: { kind: "consult", role: "devops" },
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

  /**
   * The Role each duty names, by duty key, `null` for none: until a test sets one, its default
   * Role key, as People's are.
   */
  readonly holders = new Map<string, string | null>();

  holderOf(duty: string): Promise<string | undefined> {
    const roleKey = this.namedFor(duty);
    return Promise.resolve(roleKey !== undefined && this.people.has(roleKey) ? roleKey : undefined);
  }

  dutyHolders(): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(
      new Map(
        DUTIES.flatMap(({ key }) => {
          const roleKey = this.namedFor(key);
          return roleKey !== undefined && this.people.has(roleKey) ? [[key, roleKey] as const] : [];
        }),
      ),
    );
  }

  dutyRoleKey(duty: string): Promise<string | undefined> {
    return Promise.resolve(this.namedFor(duty));
  }

  private namedFor(duty: string): string | undefined {
    if (this.holders.has(duty)) return this.holders.get(duty) ?? undefined;
    return DUTIES.find(({ key }) => key === duty)?.defaultRoleKey;
  }

  /** People's own check, consulting the Roles of `titles` and the people here. */
  permissionNarrowingProblems(roleKey: string, narrowing: StagePermissions): Promise<string[]> {
    const person = this.people.get(roleKey);
    if (!person) return Promise.resolve([]);
    return Promise.resolve(
      permissionNarrowingProblems(roleKey, person.card.permissionProfile, narrowing, {
        consultable: new Set([...this.titles.keys(), ...this.people.keys()]),
        mcpConsultant: this.holders.get("mcp-tool-consultant") ?? undefined,
      }),
    );
  }
}

/** A message a Stage Thread logged, as the test ports keep it. */
export interface StageThreadMessageForTests {
  readonly threadId: string;
  readonly at: Date;
  readonly text: string;
}

/**
 * Stage Threads' messages in memory, one line each: the Stage Threads log each turn's output here.
 * Conversations' own tests cover how `read_threads` words them.
 */
@Injectable()
export class StageThreadMessagesForTests extends StageThreadMessages {
  readonly logged: StageThreadMessageForTests[] = [];

  async words(window: StageRunThreadWindow, limit: number): Promise<string> {
    const lines: string[] = [];
    const inWindow = this.inWindow(window);
    for (const { at, text } of inWindow) {
      const line = `- ${at.toISOString()} · the Agent: ${text}`;
      if ([...lines, line].join("\n").length > limit - 100) {
        return [...lines, `… ${inWindow.length - lines.length} more left out.`].join("\n");
      }
      lines.push(line);
    }
    return lines.length === 0 ? "No Thread messages were logged." : lines.join("\n");
  }

  async count(window: StageRunThreadWindow): Promise<number> {
    return this.inWindow(window).length;
  }

  private inWindow({ threadId, from, to }: StageRunThreadWindow): StageThreadMessageForTests[] {
    return this.logged.filter(
      (message) => message.threadId === threadId && message.at >= from && message.at <= to,
    );
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
  /** Each Stage session moved to a Stand-in Engine, in order, by its Thread. */
  readonly switched: ({ readonly threadId: string; readonly standIn: EngineModel } & {
    readonly why: Parameters<StageThread["switchTo"]>[1];
  })[] = [];
  /** What `switchTo` fails with, as a test sets it: it moves the session, unless set. */
  switchFails: Error | undefined = undefined;
  /** Told as a session moves to a Stand-in Engine, such as for the user to pause meanwhile. */
  whileSwitching: ((threadId: string) => void | Promise<void>) | undefined = undefined;
  /**
   * The context limit each Thread's session passed, as a test scripts it: none unless set, and
   * none again once the Thread restarts.
   */
  readonly limitPassed = new Map<string, StageContextLimitPassed>();
  /** Each restart of a Stage's session, in order, by its Thread. */
  readonly restarted: {
    readonly threadId: string;
    readonly brief: string;
    readonly handoverNote: string | undefined;
  }[] = [];

  constructor(
    private readonly sessions: EngineSessions,
    private readonly messages: StageThreadMessagesForTests,
  ) {
    super();
  }

  /** How each Stage's session begins, as a test sets it: a new session, unless set. */
  move: StageSessionMove = "fresh";

  /** The session's context after each turn, as a test sets it: not reported, unless set. */
  contextAfterTurn: StageRunContext | undefined = undefined;

  /** The engine each Stage's session runs on, as a test sets it: the first Claude Code engine. */
  engineId: EngineId = FIRST_CLAUDE_CODE_ENGINE.id;

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
    // A Stand-in Engine the Task's Start chose for the engine runs in its place, as Conversations'.
    const standIn = request.engineStandIns.find(({ engineId }) => engineId === this.engineId);
    let engine = standIn?.standInId ?? this.engineId;
    let standInFor: StageRunStandIn | undefined = standIn && {
      engineId: standIn.engineId,
      engineName: standIn.engineName,
      reason: standIn.reason,
    };
    const model = "scripted";
    const session = await this.sessions.start({
      id: randomUUID(),
      settings: {
        engineId: engine,
        officeToolRuling: RUN_EVERY_CALL,
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
          this.messages.logged.push({
            threadId,
            at: new Date(),
            text: typeof event.output === "string" ? event.output : JSON.stringify(event.output),
          });
          await this.whileWorking?.(request);
          const problem = event.outcome === "completed" ? undefined : event.errors.join(" ");
          const { usedUpWindow } = event;
          return {
            output: event.output,
            problem,
            tokens: event.usage,
            context: this.contextAfterTurn,
            ...(usedUpWindow && {
              usedUpWindow: { window: usedUpWindow.window, resetsAt: usedUpWindow.resetsAt },
            }),
          };
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
      // A new session every Stage, unless a test says the Stage went on in one.
      move: { move: this.move },
      get engine() {
        return engine;
      },
      model,
      get standInFor() {
        return standInFor;
      },
      nextTurn,
      contextTokens: () => this.contextAfterTurn?.tokens ?? 0,
      // The scripted session goes on as it is, as though resumed on the stand-in.
      switchTo: async (to, why) => {
        this.switched.push({ threadId, standIn: to, why });
        if (this.switchFails) throw this.switchFails;
        await this.whileSwitching?.(threadId);
        standInFor = { engineId: engine, engineName: engine, reason: "Its window is used up." };
        engine = to.engineId;
      },
      askedDecision: async () => asked,
      contextLimitPassed: () => this.limitPassed.get(threadId),
      // The scripted session goes on as it is, as though fresh, its next turn answering the Brief.
      restart: async ({ record, work }, handoverNote) => {
        const brief = `${record}\n\n## What to do now\n\n${work}`;
        this.restarted.push({ threadId, brief, handoverNote });
        this.limitPassed.delete(threadId);
        session.send({ id: randomUUID(), text: brief }, "later");
        turnRunning = true;
        return brief;
      },
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

  /** Each held run's idle session moved to a Stand-in Engine as the user chose, in order. */
  readonly movedToStandIn: ({ readonly threadId: string; readonly standIn: EngineModel } & {
    readonly why: Parameters<StageThreads["moveToStandIn"]>[2];
  })[] = [];
  /** What `moveToStandIn` fails with, as a test sets it: it moves the session, unless set. */
  moveFails: Error | undefined = undefined;
  /** Told as a held run's session moves, such as for the reset to come meanwhile. */
  whileMoving: ((threadId: string) => void | Promise<void>) | undefined = undefined;

  async moveToStandIn(
    threadId: string,
    standIn: EngineModel,
    why: Parameters<StageThreads["moveToStandIn"]>[2],
  ): Promise<void> {
    await this.whileMoving?.(threadId);
    if (this.moveFails) throw this.moveFails;
    this.movedToStandIn.push({ threadId, standIn, why });
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

/** The Office defaults of Settings › Office limits, as a test sets them: the contracts' defaults. */
@Injectable()
export class StageContextLimitDefaultsForTests extends StageContextLimitDefaults {
  limits: ContextLimits = { soft: 100_000, hard: 180_000 };

  stageContextLimits(): Promise<ContextLimits> {
    return Promise.resolve(this.limits);
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

/** Each session is the Developer's, asked by nobody until a test says who. */
@Injectable()
export class SessionPeopleForTests extends SessionPeople {
  asked: { readonly userId: string; readonly name: string } | undefined = undefined;

  personInSession(): Promise<string | undefined> {
    return Promise.resolve("developer");
  }

  askedByInSession(): Promise<{ readonly userId: string; readonly name: string } | undefined> {
    return Promise.resolve(this.asked);
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
  /** Each merge commit Resolve made, with the paths its own resolution changed. */
  private readonly merges = new Map<string, readonly string[]>();
  /** What each Task's worktree holds uncommitted, as an Agent's edits leave it. */
  readonly uncommitted = new Map<string, readonly string[]>();
  /** Every discard The Office made, in order, with the paths it dropped. */
  readonly discarded: { readonly taskId: string; readonly paths: readonly string[] }[] = [];
  /** Every commit The Office made, in order, with the paths it holds: what was uncommitted. */
  readonly commits: {
    readonly taskId: string;
    readonly message: string;
    readonly commit: string;
    readonly paths: readonly string[];
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
    // A conflict after a clean merge of the Initiative's branch has moved HEAD too, as git's would.
    const movedTo =
      update.kind === "updated" || update.kind === "conflicted" ? update.commit : undefined;
    if (movedTo !== undefined) this.heads.set(taskId, { ...this.headOf(taskId), commit: movedTo });
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
    this.commits.push({ taskId, message, commit, paths: this.uncommitted.get(taskId) ?? [] });
    this.move(taskId, { commit, branch: this.headOf(taskId).branch });
    return Promise.resolve(commit);
  }

  /**
   * Moves the Task's HEAD to a merge commit Resolve made, as git's would, holding what was left
   * uncommitted as the merge's own resolution.
   */
  merged(taskId: string, commit: string): void {
    this.merges.set(commit, this.uncommitted.get(taskId) ?? []);
    this.move(taskId, { commit, branch: this.headOf(taskId).branch });
  }

  committedPaths(_projectId: string, _taskId: string, commit: string): Promise<readonly string[]> {
    const paths =
      this.commits.find((each) => each.commit === commit)?.paths ?? this.merges.get(commit);
    if (paths === undefined) return Promise.reject(new Error(`No commit ${commit}.`));
    return Promise.resolve(paths);
  }

  discard(_projectId: string, taskId: string): Promise<readonly string[]> {
    this.observe?.("discard");
    const paths = this.uncommitted.get(taskId) ?? [];
    this.uncommitted.delete(taskId);
    this.discarded.push({ taskId, paths });
    return Promise.resolve(paths);
  }

  /** Every push of a Publishing Task's branch, by Task, in order. */
  readonly pushes: string[] = [];
  /** Why pushing each Task's branch fails, when a test says it does. */
  readonly pushFailures = new Map<string, string>();

  pushPublishingBranch(_projectId: string, taskId: string): Promise<PublishingBranchPush> {
    this.pushes.push(taskId);
    const reason = this.pushFailures.get(taskId);
    return Promise.resolve(reason === undefined ? { kind: "pushed" } : { kind: "failed", reason });
  }

  changesSoFar(_projectId: string, taskId: string): Promise<string | undefined> {
    this.observe?.("changesSoFar");
    return Promise.resolve(this.changes.get(taskId));
  }

  changeBases(): Promise<readonly string[]> {
    return Promise.resolve(["refs/remotes/origin/main"]);
  }

  /** The commit each Task's base is at, fetched fresh, as a Start over's reset takes it. */
  baseCommit = "b".repeat(40);
  /** Every local ref kept by a Start over's reset, with the head it keeps. */
  readonly keptRefs = new Map<string, string>();

  resetBranchToBase(
    _projectId: string,
    taskId: string,
    keptRef: string,
  ): Promise<{ readonly resetTo: string; readonly commit: string }> {
    this.keptRefs.set(keptRef, this.headOf(taskId).commit);
    this.uncommitted.delete(taskId);
    this.move(taskId, { commit: this.baseCommit, branch: this.headOf(taskId).branch });
    return Promise.resolve({ resetTo: aTaskRecord().project.baseBranch, commit: this.baseCommit });
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
  /** Whom each command run, in order, was told to consult for a command the Project lacks. */
  readonly setUpBy: ({ readonly name: string } | undefined)[] = [];
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

  /**
   * Runs a condition command as `runCommand` runs a Script Stage's, from the same queue and into
   * `ran`, keeping the file of earlier Stage runs as it read then in `stageRunsFiles`.
   */
  async runConditionCommand(
    _projectId: string,
    taskId: string,
    key: string,
    stageRunsFile: string,
    stageRunId: string,
    options: TaskCommandOptions,
  ): Promise<ScriptCommandResult> {
    this.stageRunsFiles.push({ path: stageRunsFile, text: await readFile(stageRunsFile, "utf8") });
    const runs = await this.runsOf(taskId, key, stageRunId, options);
    return { kind: this.commandKinds.get(key), runs: runs.slice(0, 1) };
  }

  /** Each condition command's file of earlier Stage runs, with what it held as the command ran. */
  readonly stageRunsFiles: { readonly path: string; readonly text: string }[] = [];

  private async runsOf(
    taskId: string,
    key: string,
    stageRunId: string,
    { signal, wait, setUpBy }: TaskCommandOptions,
  ): Promise<readonly ScriptCommandRun[]> {
    this.observe?.("runCommand");
    this.setUpBy.push(setUpBy);
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

  /** The Project's before and after publishing lines: blank unless a test sets them. */
  readonly publishingLineSet: Record<PublishingLine, string> = {
    beforePublishingCommand: "",
    afterPublishingCommand: "",
  };
  /** What the next publishing lines give, in order; each passes otherwise. */
  readonly publishingLineRuns: CommandRun[] = [];
  /** Every publishing line run, in order, with the variables it got. */
  readonly publishingLinesRan: {
    readonly taskId: string;
    readonly line: PublishingLine;
    readonly variables: Readonly<Record<string, string>>;
  }[] = [];
  /** Told as each publishing line runs, as a line's own changes to the worktree would be made. */
  onPublishingLine: ((taskId: string, line: PublishingLine) => void) | undefined = undefined;

  publishingLines(): Promise<Readonly<Record<PublishingLine, string>>> {
    return Promise.resolve({ ...this.publishingLineSet });
  }

  runPublishingLine(
    _projectId: string,
    taskId: string,
    line: PublishingLine,
    variables: Readonly<Record<string, string>>,
  ): Promise<CommandRun | undefined> {
    const commandLine = this.publishingLineSet[line];
    if (commandLine.trim() === "") return Promise.resolve(undefined);
    this.publishingLinesRan.push({ taskId, line, variables });
    this.onPublishingLine?.(taskId, line);
    return Promise.resolve(
      this.publishingLineRuns.shift() ?? aCommandRun(commandLine, "passed", "done"),
    );
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
  /** Every Publish, in order, with the commit message it lands. */
  readonly published: {
    readonly taskId: string;
    readonly message: CommitMessage;
    readonly target: PublishTarget;
  }[] = [];

  publish(
    _projectId: string,
    taskId: string,
    message: CommitMessage,
    target: PublishTarget,
  ): Promise<Publication> {
    this.published.push({ taskId, message, target });
    const publication = this.publications.shift() ?? {
      kind: "pull-request-opened",
      branch: aTaskRecord().worktree.branch,
      url: "https://github.com/notnullsoft/admin/pull/7",
    };
    // A merge, or a conflict after a clean merge of the Initiative's branch, moved the branch.
    const movedTo =
      publication.kind === "merged" || publication.kind === "base-moved"
        ? publication.commit
        : undefined;
    if (movedTo !== undefined) this.mergedAt(taskId, movedTo);
    return Promise.resolve(publication);
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
    // A conflict after a clean merge of the Initiative's branch: that merge moved the branch.
    if (start.kind === "conflicted" && start.commit !== undefined) {
      this.mergedAt(taskId, start.commit);
    }
    // A conflict leaves the merge in progress, as git's does, until it is committed or given back.
    if (start.kind === "conflicted") this.git.merging.add(taskId);
    return Promise.resolve(start);
  }

  finishResolve(_projectId: string, taskId: string): Promise<ResolveEnd> {
    this.resolveCalls.push({ call: "finish", taskId });
    const end = this.resolveEnds.shift() ?? { kind: "resolved", commit: RESOLVED_COMMIT };
    if (end.kind === "resolved") {
      this.git.merged(taskId, end.commit);
      this.git.merging.delete(taskId);
    }
    return Promise.resolve(end);
  }

  /** A clean merge moves the Task's branch, as git's would. */
  private mergedAt(taskId: string, commit: string): void {
    this.git.move(taskId, { commit, branch: aTaskRecord().worktree.branch });
  }

  abandonResolve(_projectId: string, taskId: string): Promise<void> {
    this.resolveCalls.push({ call: "abandon", taskId });
    this.git.merging.delete(taskId);
    return Promise.resolve();
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
      PipelineInitiativesForTests,
      StartedTasksForTests,
      TaskRecordsForTests,
      KnownPeopleForTests,
      StageThreadsForTests,
      StageThreadMessagesForTests,
      StageDecisionsForTests,
      TaskGitForTests,
      TaskCommandsForTests,
      TaskPublishingForTests,
      TaskScreenshotsForTests,
      TaskUsageForTests,
      StageContextLimitDefaultsForTests,
      TaskThreadSessionsForTests,
      SessionPeopleForTests,
      StageRoleEnginesForTests,
      RoleEngineCascadeForTests,
      RunEnvironmentDefinitionsForTests,
      TaskConsultationsForTests,
      ProposalAppliers,
      PipelineRoleSources,
      TaskStageEdits,
      TaskStartOvers,
      TaskEngineChecks,
    ];
    return { module: PipelinesPortsForTestsModule, imports, providers, exports: providers };
  }
}
