import { randomUUID } from "node:crypto";
import { Injectable, Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { EngineSessions } from "../../engine/index.js";
import { KnownPeople, type KnownPerson } from "./known-people.js";
import { StageDecisions, type StageDecisionRequest } from "./stage-decisions.js";
import {
  StageThreads,
  type AskedDecision,
  type StageThread,
  type StageThreadRequest,
  type StageTurn,
} from "./stage-threads.js";
import { StartedTasks, type StartedTask, type WalkTaskState } from "./started-tasks.js";
import type { CommandRun, Installation, ScriptCommandRun } from "../domain/stage-command-run.js";
import { TaskCommands, type ScriptCommandKey } from "./task-commands.js";
import { TaskGit, type WorktreeHead } from "./task-git.js";
import { TaskRecords, type TaskRecord } from "./task-records.js";
import { TaskUsage } from "./task-usage.js";

/** Work's Tasks in memory: a test starts each one it walks. */
@Injectable()
export class StartedTasksForTests extends StartedTasks {
  private readonly tasks = new Map<string, StartedTask>();
  /** Every state the walk moved a Task to, in order. */
  readonly changes: { readonly taskId: string; readonly state: WalkTaskState }[] = [];

  /** Puts the Task as Work would, such as In progress as it starts. */
  put(taskId: string, task: Omit<StartedTask, "id">): void {
    this.tasks.set(taskId, { ...task, id: taskId });
  }

  async list(): Promise<readonly StartedTask[]> {
    return [...this.tasks.values()];
  }

  async read(taskId: string): Promise<StartedTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`There is no Task ${taskId}.`);
    return task;
  }

  /** As Work moves it: a Paused Task stays Paused, held by the user. */
  async changeState(taskId: string, state: WalkTaskState): Promise<StartedTask> {
    const task = await this.read(taskId);
    if (task.state === "paused") return task;
    this.put(taskId, { ...task, state });
    this.changes.push({ taskId, state });
    return this.read(taskId);
  }
}

/** A Task's record as Work would give it: planned, with one Attachment, in its worktree. */
export function aTaskRecord(fields: Partial<TaskRecord> = {}): TaskRecord {
  return {
    title: "Rename a device",
    plan: "Add a rename dialog to the device page.",
    definitionOfDone: ["The new name shows on the list", "The rename persists"],
    attachmentLines: ["- mockup.png (image, image/png, 2048 bytes) · Attachment a-1"],
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Admin panel",
      baseBranch: "main",
      commands: { install: "npm ci", build: "npm run build", lint: "", test: "npm test" },
      useProjectSkills: false,
    },
    worktree: {
      path: "/office/worktrees/admin-panel/task",
      branch: "office/task",
      environment: { PROJECT_VARIABLE: "set" },
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
  return { card: { name, permissionProfile: { edit: true, run: "project-commands", web: false } } };
}

/** People by the key of the Role they fill: Ada fills `developer` until a test changes it. */
@Injectable()
export class KnownPeopleForTests extends KnownPeople {
  readonly people = new Map<string, KnownPerson>([["developer", aPerson()]]);

  find(roleKey: string): Promise<KnownPerson | undefined> {
    return Promise.resolve(this.people.get(roleKey));
  }
}

/**
 * Stage Threads as a session each on the engine, which tests script: a new session every Stage,
 * started with the record and the Stage's work. Conversations' own tests cover the Context policy.
 */
@Injectable()
export class StageThreadsForTests extends StageThreads {
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
  /** Told as The Office waits on each turn, while it runs, such as for the user to stop it. */
  whileTurnRuns: ((threadId: string) => void) | undefined = undefined;
  /**
   * The Decision the person opens with an Office tool in each turn, as a test has them ask; none
   * unless one is set.
   */
  asksInTurn: ((request: StageThreadRequest) => AskedDecision | undefined) | undefined = undefined;
  /** The Threads whose Stage The Office found left running as it started, with why it ended. */
  readonly endedLeftRunning: { readonly threadId: string; readonly failure: string }[] = [];

  constructor(private readonly sessions: EngineSessions) {
    super();
  }

  async open(request: StageThreadRequest): Promise<StageThread> {
    this.requests.push(request);
    const threadId = randomUUID();
    const session = await this.sessions.start({
      id: randomUUID(),
      settings: {
        folder: request.folder,
        environment: request.environment,
        model: "scripted",
        effort: "low",
        instructions: request.session.instructions,
        skills: undefined,
        profile: request.session.profile,
        officeTools: [],
        outputSchema: request.session.outputSchema,
      },
      brief: { id: randomUUID(), text: `${request.record}\n\n${request.work}` },
    });
    const events = session.events[Symbol.asyncIterator]();
    let turnRunning = true;
    const nextTurn = async (): Promise<StageTurn> => {
      this.whileTurnRuns?.(threadId);
      for (;;) {
        const next = await events.next();
        if (next.done) throw new Error(`Session ${session.id} ended without a turn.`);
        const event = next.value;
        if (event.kind === "turn-ended") {
          turnRunning = false;
          await this.whileWorking?.(request);
          const problem = event.outcome === "completed" ? undefined : event.errors.join(" ");
          return {
            output: event.output,
            problem,
            tokens: event.usage,
            decision: this.asksInTurn?.(request),
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
      // A new session every Stage, as said above.
      move: { move: "fresh" },
      nextTurn,
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

  async endLeftRunning(threadId: string, failure: string): Promise<void> {
    this.endedLeftRunning.push({ threadId, failure });
  }
}

/** Conversations' Decisions in memory: each one opened, by its id. */
@Injectable()
export class StageDecisionsForTests extends StageDecisions {
  readonly opened = new Map<string, StageDecisionRequest>();

  open(request: StageDecisionRequest): Promise<string> {
    const id = randomUUID();
    this.opened.set(id, request);
    return Promise.resolve(id);
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

  tokensSoFar(taskId: string): Promise<number> {
    this.observe?.(taskId);
    return Promise.resolve(this.tokens.get(taskId) ?? 0);
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
  observe: ((call: "head" | "commit" | "discard" | "changesSoFar") => void) | undefined = undefined;

  /** Moves the Task's HEAD, as an Agent with git of its own would. */
  move(taskId: string, head: WorktreeHead): void {
    this.heads.set(taskId, head);
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
    movedFiles: undefined,
  };
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
  /** Every command run, in order. */
  readonly ran: {
    readonly taskId: string;
    readonly key: ScriptCommandKey;
    readonly stageRunId: string;
  }[] = [];
  /** Told of every call, as it is made, so a test can see what happened before it. */
  observe: ((call: "install" | "runCommand") => void) | undefined = undefined;
  /** Set while the next command runs until its signal stops it, as a hung test run would. */
  runsUntilStopped = false;

  install(): Promise<Installation> {
    this.observe?.("install");
    return Promise.resolve(this.installations.shift() ?? { kind: "up-to-date" });
  }

  async runCommand(
    _projectId: string,
    taskId: string,
    key: ScriptCommandKey,
    stageRunId: string,
    signal: AbortSignal,
  ): Promise<readonly ScriptCommandRun[]> {
    this.observe?.("runCommand");
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
}

/** The ports' stand-ins, the Stage Threads' sessions on the engine `imports` give. */
@Module({})
export class PipelinesPortsForTestsModule {
  static register(imports: NonNullable<ModuleMetadata["imports"]>): DynamicModule {
    const providers = [
      StartedTasksForTests,
      TaskRecordsForTests,
      KnownPeopleForTests,
      StageThreadsForTests,
      StageDecisionsForTests,
      TaskGitForTests,
      TaskCommandsForTests,
      TaskUsageForTests,
    ];
    return { module: PipelinesPortsForTestsModule, imports, providers, exports: providers };
  }
}
