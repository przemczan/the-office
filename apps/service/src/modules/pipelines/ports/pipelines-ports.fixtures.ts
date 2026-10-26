import { randomUUID } from "node:crypto";
import { Injectable, Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { EngineSessions } from "../../engine/index.js";
import { KnownPeople, type KnownPerson } from "./known-people.js";
import {
  StageThreads,
  type StageThread,
  type StageThreadRequest,
  type StageTurn,
} from "./stage-threads.js";
import { StartedTasks, type StartedTask, type WalkTaskState } from "./started-tasks.js";
import { TaskRecords, type TaskRecord } from "./task-records.js";

/** Work's Tasks in memory: a test starts each one it walks. */
@Injectable()
export class StartedTasksForTests extends StartedTasks {
  private readonly tasks = new Map<string, StartedTask>();
  /** Every state the walk moved a Task to, in order. */
  readonly changes: { readonly taskId: string; readonly state: WalkTaskState }[] = [];

  /** Puts the Task as Work would, such as In progress as it starts. */
  put(taskId: string, task: StartedTask): void {
    this.tasks.set(taskId, task);
  }

  async read(taskId: string): Promise<StartedTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`There is no Task ${taskId}.`);
    return task;
  }

  async changeState(taskId: string, state: WalkTaskState): Promise<void> {
    this.put(taskId, { ...(await this.read(taskId)), state });
    this.changes.push({ taskId, state });
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
  /** How each Stage's work in its Thread ended. */
  readonly ended: ({ readonly threadId: string } & Parameters<StageThread["end"]>[0])[] = [];

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
    const nextTurn = async (): Promise<StageTurn> => {
      for (;;) {
        const next = await events.next();
        if (next.done) throw new Error(`Session ${session.id} ended without a turn.`);
        const event = next.value;
        if (event.kind === "turn-ended") {
          const problem = event.outcome === "completed" ? undefined : event.errors.join(" ");
          return { output: event.output, problem };
        }
      }
    };
    return {
      threadId,
      nextTurn,
      send: (text, why) => {
        this.sent.push({ threadId, text, why });
        session.send({ id: randomUUID(), text }, "later");
        return nextTurn();
      },
      end: async (ending) => {
        this.ended.push({ threadId, ...ending });
        await session.end();
      },
    };
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
    ];
    return { module: PipelinesPortsForTestsModule, imports, providers, exports: providers };
  }
}
