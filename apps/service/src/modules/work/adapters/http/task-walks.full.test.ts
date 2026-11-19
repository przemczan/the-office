import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import {
  startAnswerSchema,
  officeUpdateSchema,
  pipelineSchema,
  PROJECT_LIMIT_MAX,
  projectSchema,
  queueSchema,
  taskSchema,
  taskStagesSchema,
  type OfficeUpdate,
  type Pipeline,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import { BusyWork, ScheduledExits } from "../../../office-updates/index.js";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
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
import {
  createOfficeCheckout,
  updateSystem,
  type OfficeCheckoutForTests,
} from "../../../office-updates/index.fixtures.js";
import { MemoryService, RoleCards, type SessionRole } from "../../../people/index.js";
import { ownProjectsStartedTasks } from "../../../pipelines/index.fixtures.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../../people/index.fixtures.js";

const run = promisify(execFile);

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

const NOTHING = (): void => undefined;

interface HeldTurn {
  readonly started: Promise<void>;
  release(): void;
}

/** Holds the Task's first session from starting, its brief sent: a turn going on until released. */
function holdTurn(engine: EditingEngine, taskId: string): HeldTurn {
  let release = NOTHING;
  let begun = NOTHING;
  const started = new Promise<void>((resolve) => (begun = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  engine.editAtStart(taskId, async () => {
    begun();
    await released;
  });
  return { started, release };
}

/** Another Agent Stage of the test's Developer. */
function developerStage(office: Office, key: string, name: string): object {
  return {
    kind: "agent",
    key,
    name,
    optional: false,
    role: office.developerKey,
    brief: "Check it.",
    session: "fresh",
    budget: 100_000,
  };
}

async function officeUpdateOf(office: Office): Promise<OfficeUpdate> {
  return officeUpdateSchema.parse(await (await office.send("GET", "/office-update")).json());
}

const REVIEW_GATE = {
  kind: "gate",
  key: "review",
  name: "Review",
  optional: false,
} as const;

interface Office {
  readonly app: INestApplication;
  readonly engine: EditingEngine;
  /** The service's own checkout, behind which a newer commit can be pushed. */
  readonly checkout: OfficeCheckoutForTests;
  /** The folder the launcher would share with the service. */
  readonly updateFolder: string;
  readonly developerKey: string;
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
  /** Holds the Task's first session, a turn going on, until released or until `close`. */
  holdTurn(taskId: string): HeldTurn;
  close(): Promise<void>;
}

/**
 * The whole service on the scripted engine, with a Developer of the test's own whose Task limit is
 * `taskLimit`, so only this test's Tasks count against it, and a Project on a repository of its
 * own, publishing by merge, whose commands all pass.
 */
async function startOffice({ taskLimit } = { taskLimit: 1 }): Promise<Office> {
  const folder = await mkdtemp(join(tmpdir(), "office-queue-walk-"));
  const checkout = await createOfficeCheckout(join(folder, "office"));
  const updateFolder = join(folder, "update");
  await mkdir(updateFolder);
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
          officeUpdateFolder: updateFolder,
        },
        { directory: folder, source: "built" },
        checkout.path,
      ),
    ],
    overrides: [
      { provide: WorkSettings, useValue: settings },
      { provide: RoleCards, useValue: roleCardsOf(developerKey, taskLimit) },
      { provide: MemoryService, useValue: NO_MEMORY },
      updateSystem(),
      ownProjectsQueue(() => ownProjectIds),
      ownProjectsStartedTasks(() => ownProjectIds),
    ],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  });
  const ownIds: string[] = [];
  const heldTurns: HeldTurn[] = [];
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
        installCommand: PASSING_COMMAND,
        commands: [
          { key: "build", name: "Build", kind: "build", commandLine: PASSING_COMMAND },
          { key: "lint", name: "Lint", kind: "lint", commandLine: PASSING_COMMAND },
          { key: "test", name: "Test", kind: "test", commandLine: PASSING_COMMAND },
        ],
        installInputs: ["package-lock.json"],
        publishingMode: "merge",
        defaultPipeline: "quick-fix",
      })
    ).json(),
  );
  ownProjectIds = [project.id];
  // These Tasks start beside each other in the one Project, so only the waits under test hold them.
  const roomy = await send("PUT", `/projects/${project.id}/project-limit`, {
    projectLimit: PROJECT_LIMIT_MAX,
  });
  expect(roomy.status).toBe(200);
  return {
    app,
    engine,
    checkout,
    updateFolder,
    developerKey,
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
      await send("POST", `/tasks/${task.id}/plan/confirm`);
      await send("POST", `/tasks/${task.id}/definition-of-done/confirm`);
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
    holdTurn(taskId) {
      const turn = holdTurn(engine, taskId);
      heldTurns.push(turn);
      return turn;
    },
    async close() {
      // A test that failed mid-turn would otherwise hang here, hiding its own failure: the service
      // waits for the turn as it closes.
      for (const turn of heldTurns) turn.release();
      for (const id of ownIds) await send("POST", `/tasks/${id}/drop`);
      await app.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}

/** The Role holding Plans in these walks. */
const PLANNER = "planner";

/**
 * The Planner, who holds Plans, and the test's own Developer, both hired, with no Memory in use.
 */
function roleCardsOf(developerKey: string, taskLimit: number): Partial<RoleCards> {
  const roleOf = (key: string): SessionRole => ({
    roleKey: key,
    cardVersion: 1,
    mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
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
    holderOf: (duty) => Promise.resolve(duty === "plans" ? PLANNER : undefined),
    dutyHolders: () => Promise.resolve(new Map([["plans", PLANNER]])),
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
  capabilities: { sharedMemory: false, chat: true, consultant: false, runEnvironment: false },
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

/*
 * Tasks walked through their Pipelines by the whole service on the scripted engine and real git: slow
 * scenarios, kept out of tasks.controller.test.ts so neither file holds the run up
 * (apps/service/docs/testing.md).
 */

describe("An Office update, through the scripted engine", () => {
  it(
    "waits for a Stage's turn, queues new Starts meanwhile, and not for a Task waiting on you",
    async () => {
      const office = await startOffice({ taskLimit: 2 });
      try {
        const [newest] = await office.checkout.pushNewer("A newer Office");
        const pipeline = await office.aPipeline();
        const first = await office.readyTask(pipeline.id);
        const second = await office.readyTask(pipeline.id);
        const ready = vi.fn<() => void>();
        office.app.get(ScheduledExits).onReadyToExit(ready);
        const turn = office.holdTurn(first.id);
        office.engine.queue(DEVELOPER_SESSION);

        await office.send("POST", `/tasks/${first.id}/start`);
        await turn.started;
        expect((await office.send("POST", "/office-update/schedule")).status).toBe(204);
        const queued = startAnswerSchema.parse(
          await (await office.send("POST", `/tasks/${second.id}/start`)).json(),
        );

        expect(queued.queued?.reasons).toEqual(["An update is scheduled."]);
        const scheduled = await officeUpdateOf(office);
        expect(scheduled.scheduled).toMatchObject({
          kind: "update",
          target: { kind: "commit", commit: newest },
        });
        expect(scheduled.scheduled?.busy).toEqual([
          { kind: "turn", label: `${DEVELOPER_NAME} in the Stage Build` },
        ]);
        expect(ready).not.toHaveBeenCalled();
        turn.release();
        // At its Gate, Waiting on you: nothing of it is busy.
        await office.untilState(first.id, "waiting-on-you");
        await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
        const request = JSON.parse(
          await readFile(join(office.updateFolder, "request.json"), "utf8"),
        );
        expect(request).toEqual({ kind: "commit", target: newest });
        expect((await office.send("DELETE", "/office-update/schedule")).status).toBe(422);
      } finally {
        await office.close();
      }
    },
    REAL_GIT_TEST_MS,
  );

  it(
    "holds a Task's next Stage at its boundary, and Cancel releases it and the queued Start",
    async () => {
      const office = await startOffice({ taskLimit: 2 });
      // Something else is busy all along, so the update never goes ahead.
      const endBusy = office.app.get(BusyWork).begin({ kind: "clone", label: "A clone" });
      try {
        await office.checkout.pushNewer("A newer Office");
        const pipeline = await office.aPipeline([
          developerStage(office, "check", "Check"),
          REVIEW_GATE,
        ]);
        const first = await office.readyTask(pipeline.id);
        const second = await office.readyTask((await office.aPipeline()).id);
        const turn = office.holdTurn(first.id);
        office.engine.queue(DEVELOPER_SESSION, DEVELOPER_SESSION, DEVELOPER_SESSION);

        await office.send("POST", `/tasks/${first.id}/start`);
        await turn.started;
        expect((await office.send("POST", "/office-update/schedule")).status).toBe(204);
        await office.send("POST", `/tasks/${second.id}/start`);
        turn.release();
        await vi.waitFor(async () =>
          expect((await office.stagesOf(first.id))[0]?.runs[0]?.endedAt).toBeTruthy(),
        );
        // Long enough for a walk that went on to start its next Stage's run.
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect((await office.stagesOf(first.id))[1]?.runs).toEqual([]);
        expect(await office.queue()).toEqual([second.id]);
        expect((await office.send("DELETE", "/office-update/schedule")).status).toBe(204);
        await office.untilState(first.id, "waiting-on-you");
        await office.untilState(second.id, "waiting-on-you");
        expect(await office.queue()).toEqual([]);
      } finally {
        endBusy();
        await office.close();
      }
    },
    REAL_GIT_TEST_MS,
  );
});
