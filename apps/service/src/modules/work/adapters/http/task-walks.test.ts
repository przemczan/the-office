import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
  pipelineSchema,
  projectSchema,
  queueSchema,
  startAnswerSchema,
  taskSchema,
  taskStagesSchema,
  type Pipeline,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../../test/test-database.js";
import { AppModule } from "../../../../app.module.js";
import { GITHUB_SITE } from "../../../../platform/git-identity/github-site.js";
import {
  EngineModule,
  ScriptedEngine,
  ScriptedEngineModule,
  type EngineSession,
  type NewSession,
  type SessionScript,
} from "../../../engine/index.js";
import { MemoryService, RoleCards, type SessionRole } from "../../../people/index.js";
import { ownProjectsStartedTasks } from "../../../pipelines/index.fixtures.js";
import { PLANNER } from "../../domain/planning.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";

/*
 * Tasks walked through their Pipelines by the whole service on the scripted engine and real git: slow
 * scenarios, kept out of tasks.controller.test.ts so neither file holds the run up
 * (apps/service/docs/testing.md).
 */

const run = promisify(execFile);

describe("The queue, through the scripted engine", () => {
  it(
    "starts a queued Task by itself once the running one's walk ends Done, through the scripted engine",
    async () => {
      const office = await startOffice();
      try {
        const pipeline = await office.aPipeline();
        const first = await office.readyTask(pipeline.id);
        const second = await office.readyTask(pipeline.id);
        office.engine.queue(DEVELOPER_SESSION, DEVELOPER_SESSION);

        await office.send("POST", `/tasks/${first.id}/start`);
        await office.untilState(first.id, "waiting-on-you");
        const queued = startAnswerSchema.parse(
          await (await office.send("POST", `/tasks/${second.id}/start`)).json(),
        );
        const continued = await office.send("POST", `/tasks/${first.id}/gate/continue`);

        expect(continued.ok).toBe(true);
        expect(queued.queued?.reasons).toEqual([`${DEVELOPER_NAME} is at the Task limit (1).`]);
        await office.untilState(first.id, "done");
        // Released as the first walk ended: the second walks on to its own Gate.
        await office.untilState(second.id, "waiting-on-you");
        expect(await office.queue()).toEqual([]);
        await office.send("POST", `/tasks/${second.id}/drop`);
      } finally {
        await office.close();
      }
    },
    REAL_GIT_TEST_MS,
  );
});

describe("Conflicts at Publish", () => {
  it(
    "resolves a conflict at Publish in one merge commit, tests it and waits at a Gate, then fast-forwards the base to it, through the scripted engine",
    async () => {
      const office = await startOffice({ taskLimit: 2 });
      const startToItsGate = async (taskId: string, greeting: string): Promise<void> => {
        office.engine.queue(DEVELOPER_SESSION);
        office.engine.editAtStart(taskId, (worktree) =>
          writeFile(indexIn(worktree), indexWith(greeting)),
        );
        expect((await office.send("POST", `/tasks/${taskId}/start`)).ok).toBe(true);
        await office.untilState(taskId, "waiting-on-you");
      };
      const continueGate = async (taskId: string): Promise<void> => {
        expect((await office.send("POST", `/tasks/${taskId}/gate/continue`)).ok).toBe(true);
      };
      try {
        const pipeline = await office.aPipeline([REVIEW_GATE, PUBLISH]);
        const first = await office.readyTask(pipeline.id);
        const second = await office.readyTask(pipeline.id);
        // Both in progress before either publishes, each changing the same line.
        await startToItsGate(first.id, "Hello from the first Task.");
        await startToItsGate(second.id, "Hello from the second Task.");
        await continueGate(first.id);
        await office.untilState(first.id, "done");
        const firstPublished = await gitOut(office.originPath, "rev-parse", "main");
        let conflicted = "";
        office.engine.queue(DEVELOPER_SESSION);
        office.engine.editAtStart(second.id, async (worktree) => {
          conflicted = await readFile(indexIn(worktree), "utf8");
          await writeFile(indexIn(worktree), indexWith(RESOLVED_GREETING));
        });

        await continueGate(second.id);

        await vi.waitFor(
          async () =>
            expect(runsByStage(await office.stagesOf(second.id))).toEqual(AT_RESOLVE_GATE),
          { timeout: 20_000, interval: 100 },
        );
        await office.untilState(second.id, "waiting-on-you");
        expect(conflicted).toContain("<<<<<<<");
        const branch = `office/${second.id}`;
        const [merge, ...parents] = (
          await gitOut(office.repository, "rev-list", "--parents", "--max-count=1", branch)
        ).split(" ");
        expect(parents).toHaveLength(2);
        expect(parents[1]).toBe(firstPublished);
        expect(await gitOut(office.repository, "show", `${branch}:src/index.ts`)).toBe(
          indexWith(RESOLVED_GREETING).trim(),
        );

        await continueGate(second.id);
        await office.untilState(second.id, "done");

        expect(await gitOut(office.originPath, "rev-parse", "main")).toBe(merge);
      } finally {
        await office.close();
      }
    },
    REAL_GIT_TEST_MS,
  );
});

const RESOLVED_GREETING = "Hello from both Tasks.";

/**
 * The second Task's runs by Stage once Publish conflicted: Resolve, its Test and its Gate stand
 * before Publish, and the Gate waits.
 */
const AT_RESOLVE_GATE = {
  Build: ["done"],
  Review: ["done"],
  Resolve: ["done"],
  "Test after Resolve": ["done"],
  "Review the resolved conflict": ["waiting"],
  Publish: ["failed"],
};

/** How each Stage's runs ended, a Gate's run that ended reached but not acted on as "waiting". */
function runsByStage(stages: readonly TaskStage[]): Record<string, string[]> {
  return Object.fromEntries(
    stages.map(({ stage, runs }) => [
      stage.name,
      runs.map(({ outcome, gateAction }) =>
        stage.kind === "gate" && outcome !== null && gateAction === null
          ? "waiting"
          : (outcome?.status ?? "running"),
      ),
    ]),
  );
}

function indexIn(folder: string): string {
  return join(folder, "src", "index.ts");
}

function indexWith(greeting: string): string {
  return `export const greeting = "${greeting}";\n`;
}

/** Real git for the worktrees, an Agent's turn and a Gate: well past vitest's default. */
const REAL_GIT_TEST_MS = 60_000;
const DEVELOPER_NAME = "Ola";

/** A Stage's session of one turn, done with the one Definition of Done statement met. */
const DEVELOPER_SESSION: SessionScript = [
  { step: "start", brief: { id: "brief", text: "" } },
  turnEnded({
    status: "done",
    summary: "Done.",
    handoverNote: "Nothing is left.",
    definitionOfDoneMet: [1],
  }),
  { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
  { step: "end" },
];

function turnEnded(output: unknown): SessionScript[number] {
  return {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "completed",
      consumedMessageIds: ["brief"],
      usage: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
      sessionCostUsd: 0.01,
      output,
      errors: [],
    },
  };
}

/**
 * The scripted engine, with the Agent's edits: the next session that starts in a Task's worktree
 * (named after the Task) first applies the edit put for that Task, so another session starting
 * meanwhile, such as a Planner's, never takes it.
 */
class EditingEngine extends ScriptedEngine {
  private readonly edits = new Map<string, (worktree: string) => Promise<void>>();

  editAtStart(taskId: string, edit: (worktree: string) => Promise<void>): void {
    this.edits.set(taskId, edit);
  }

  override async start(session: NewSession): Promise<EngineSession> {
    const { folder } = session.options;
    const edit = this.edits.get(basename(folder));
    this.edits.delete(basename(folder));
    await edit?.(folder);
    return super.start(session);
  }
}

const REVIEW_GATE = { kind: "gate", key: "review", name: "Review", optional: false } as const;
const PUBLISH = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
} as const;

interface Office {
  readonly engine: EditingEngine;
  /** The Project's repository, whose `main` tracks the one in a bare `origin` beside it. */
  readonly repository: string;
  readonly originPath: string;
  send(method: string, path: string, body?: unknown): Promise<Response>;
  /** A library Pipeline of the test's own: its Developer's Agent Stage, then `after`. */
  aPipeline(after?: readonly object[]): Promise<Pipeline>;
  readyTask(pipelineId: string): Promise<Task>;
  untilState(taskId: string, state: Task["state"]): Promise<void>;
  stagesOf(taskId: string): Promise<readonly TaskStage[]>;
  /** The Office's own Tasks in the queue. */
  queue(): Promise<string[]>;
  close(): Promise<void>;
}

/**
 * The whole service on the scripted engine, with a Developer of the test's own whose Task limit is
 * `taskLimit`, so only this test's Tasks count against it, and a Project on a repository of its
 * own, publishing by merge, whose commands all pass.
 */
async function startOffice({ taskLimit } = { taskLimit: 1 }): Promise<Office> {
  const folder = await mkdtemp(join(tmpdir(), "office-queue-walk-"));
  const engine = new EditingEngine([]);
  const developerKey = `queue-developer-${randomUUID().slice(0, 8)}`;
  const settings = new WorkSettingsForTests();
  // Every test file's started Tasks count against the Office-wide limit: only the Task limit holds.
  await settings.changeOfficeWideLimit(1_000);
  let ownProjectIds: readonly string[] = [];
  const { app, url } = await startTestApplication({
    imports: [
      AppModule.register(
        {
          host: "127.0.0.1",
          port: 0,
          databaseUrl: testDatabaseUrl(),
          officeDataDirectory: join(folder, "data"),
          gitHub: GITHUB_SITE,
        },
        { directory: folder, source: "built" },
      ),
    ],
    overrides: [
      { provide: WorkSettings, useValue: settings },
      { provide: RoleCards, useValue: roleCardsOf(developerKey, taskLimit) },
      { provide: MemoryService, useValue: NO_MEMORY },
      ownProjectsQueue(() => ownProjectIds),
      ownProjectsStartedTasks(() => ownProjectIds),
    ],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  });
  const ownIds: string[] = [];
  const send = (method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const readTaskOf = async (taskId: string): Promise<Task> =>
    taskSchema.parse(await (await send("GET", `/tasks/${taskId}`)).json());
  const { repository, originPath } = await aRepository(folder);
  const project = projectSchema.parse(
    await (
      await send("POST", "/projects", {
        name: `Queue ${randomUUID().slice(0, 8)}`,
        path: repository,
        baseBranch: "main",
        mark: { label: "QU", colour: "teal" },
        commands: {
          install: PASSING_COMMAND,
          build: PASSING_COMMAND,
          lint: PASSING_COMMAND,
          test: PASSING_COMMAND,
        },
        installInputs: ["package-lock.json"],
        publishingMode: "merge",
        defaultPipeline: "quick-fix",
      })
    ).json(),
  );
  ownProjectIds = [project.id];
  return {
    engine,
    repository,
    originPath,
    send,
    async aPipeline(after = [REVIEW_GATE]) {
      const response = await send("POST", "/pipelines", {
        name: `Queue ${randomUUID().slice(0, 8)}`,
        description: "Its Developer's work, then what follows.",
        stages: [
          {
            kind: "agent",
            key: "build",
            name: "Build",
            optional: false,
            role: developerKey,
            brief: "Build it.",
            session: "fresh",
            budget: 100_000,
          },
          ...after,
        ],
      });
      expect(response.status).toBe(201);
      return pipelineSchema.parse(await response.json());
    },
    async readyTask(pipelineId) {
      const created = await send("POST", "/tasks", {
        title: "Fix the login redirect",
        projectId: project.id,
        priority: "normal",
      });
      const task = taskSchema.parse(await created.json());
      ownIds.push(task.id);
      // The user writes the Plan alone, so the Planner never starts.
      expect((await send("POST", `/tasks/${task.id}/planning`)).status).toBe(200);
      await send("PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
      await send("PUT", `/tasks/${task.id}/definition-of-done`, { definitionOfDone: ["Mine."] });
      await send("PUT", `/tasks/${task.id}/pipeline`, { pipelineId });
      expect((await send("POST", `/tasks/${task.id}/ready`)).status).toBe(200);
      return task;
    },
    async untilState(taskId, state) {
      await vi.waitFor(async () => expect((await readTaskOf(taskId)).state).toBe(state), {
        timeout: 20_000,
        interval: 100,
      });
    },
    async stagesOf(taskId) {
      const stages = taskStagesSchema.parse(
        await (await send("GET", `/tasks/${taskId}/stages`)).json(),
      );
      return stages.stages ?? [];
    },
    async queue() {
      const queue = queueSchema.parse(await (await send("GET", "/queue")).json());
      return queue.map(({ taskId }) => taskId).filter((taskId) => ownIds.includes(taskId));
    },
    async close() {
      for (const id of ownIds) await send("POST", `/tasks/${id}/drop`);
      await app.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}

/** The Planner and the test's own Developer, both hired, with no Memory in use. */
function roleCardsOf(developerKey: string, taskLimit: number): Partial<RoleCards> {
  const roleOf = (key: string): SessionRole => ({
    roleKey: key,
    cardVersion: 1,
    card:
      key === developerKey
        ? { ...DEVELOPER_CARD, taskLimit }
        : { ...DEVELOPER_CARD, name: "Jan", title: "Planner" },
  });
  const hired = new Set([PLANNER, developerKey]);
  return {
    find: (key) => Promise.resolve(hired.has(key) ? roleOf(key) : undefined),
    forNewSession: (key) => Promise.resolve(roleOf(key)),
    forResumedSession: (key) => Promise.resolve(roleOf(key)),
    hiredKeys: () => Promise.resolve(hired),
    consultants: () => Promise.resolve([]),
    findLetGo: () => Promise.resolve(undefined),
    roleTitle: (key) => roleOf(key).card.title,
  };
}

const DEVELOPER_CARD: SessionRole["card"] = {
  name: DEVELOPER_NAME,
  title: "Developer",
  responsibilities: "Builds what the Plan says.",
  instructions: "Keep each change small.",
  roleOverride: null,
  effort: "low",
  capabilities: { sharedMemory: false, chat: true, consultant: false },
  permissionProfile: { edit: true, run: "read-only-git", web: false, mcpTools: {} },
  hardSwitches: {
    runInstalls: { kind: "never" },
    publishOutsideThePipeline: { kind: "never" },
    changeRoles: { kind: "never" },
  },
  taskLimit: 1,
  sessionDefault: "context-policy",
};

const NO_MEMORY: Pick<MemoryService, "read"> = {
  read: () => Promise.resolve({ inUse: false, notes: [] }),
};

/** Every command of the test's Project: it passes on any workstation, with nothing to install. */
const PASSING_COMMAND = "node --version";

/**
 * A repository whose `main` holds `src/index.ts` and tracks the `main` of a bare `origin` beside
 * it, with an identity of its own (the Linux check's container has none) and files kept as written.
 */
async function aRepository(
  folder: string,
): Promise<{ readonly repository: string; readonly originPath: string }> {
  const repository = join(folder, "repository");
  const originPath = join(folder, "origin.git");
  await mkdir(join(repository, "src"), { recursive: true });
  const git = (...args: string[]) => run("git", args, { cwd: repository });
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(repository, "src", "index.ts"), 'export const greeting = "Hello.";\n');
  await git("add", ".");
  await git("commit", "-m", "First");
  await run("git", ["clone", "--quiet", "--bare", repository, originPath]);
  await git("remote", "add", "origin", originPath);
  await git("fetch", "--quiet", "origin");
  await git("branch", "--quiet", "--set-upstream-to=origin/main", "main");
  return { repository, originPath };
}

/** git's output in `folder`, trimmed. */
async function gitOut(folder: string, ...gitArguments: string[]): Promise<string> {
  return (await run("git", gitArguments, { cwd: folder })).stdout.trim();
}
