import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  ANSWER_CONSULTATION_TOOL,
  CONSULT_TOOL,
  latestEnvironmentCheckSchema,
  pipelineSchema,
  projectSchema,
  taskSchema,
  taskStagesSchema,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";
import {
  EngineModule,
  ScriptedEngine,
  ScriptedEngineModule,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
  type SessionScript,
} from "../../engine/index.js";
import {
  DUTIES,
  MemoryService,
  RoleCards,
  type DutyKey,
  type SessionRole,
} from "../../people/index.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import { ownProjectsStartedTasks } from "../../pipelines/index.fixtures.js";
import { ownProjectsQueue } from "../../work/index.fixtures.js";
import {
  CHANGE_PROJECT_SETTINGS_TOOL,
  RUN_ENVIRONMENT_CHECK_TOOL,
} from "../domain/session-instructions.js";
import { ProjectBases } from "../ports/project-bases.js";
import { noProjectBases } from "../ports/project-bases.fixtures.js";
import { dutiesProvider } from "./duties.fixtures.js";
import { DecisionService } from "./decision-service.js";
import { ThreadService } from "./thread-service.js";

const run = promisify(execFile);

type Step = SessionScript[number];

/** Devops' fixed key, which only roles.controller.test may hire into: People's cards stand in. */
const DEVOPS = "devops";
const DEVOPS_NAME = "Nina";
const DEVELOPER_NAME = "Ola";
/** The Role holding Plans, never started here: the user writes the Plan. */
const PLANNER = "planner";

/** What the Project's test command becomes: it passes on any workstation, installing nothing. */
const SET_COMMAND = 'node -e "process.exit(0)"';

const DEVCONTAINER = `{ "dockerComposeFile": ["compose.yaml"], "service": "app" }`;
const COMPOSE = "services:\n  app:\n    image: node:22\n    command: sleep infinity\n";

/** The whole app, real git, an environment check and five sessions: slow under a full run. */
const LOOP_TEST_MS = 90_000;

let folder: string;
let app: INestApplication;
let url: string;
let engine: ScriptedEngine;
let developerKey: string;
let ownProjectIds: readonly string[] = [];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-missing-command-"));
  engine = new ScriptedEngine([]);
  developerKey = `loop-developer-${randomUUID().slice(0, 8)}`;
  ({ app, url } = await startTestApplication({
    imports: [
      AppModule.register(
        {
          host: "127.0.0.1",
          port: 0,
          databaseUrl: testDatabaseUrl(),
          officeDataDirectory: join(folder, "office-data"),
          gitHub: GITHUB_SITE,
        },
        { directory: folder, source: "built" },
      ),
    ],
    overrides: [
      { provide: RoleCards, useValue: roleCardsOf(developerKey) },
      // Devops holds Onboards and repairs Projects, as by default.
      dutiesProvider(),
      { provide: MemoryService, useValue: NO_MEMORY },
      { provide: ProjectBases, useValue: noProjectBases(join(folder, "bases")) },
      ownProjectsQueue(() => ownProjectIds),
      ownProjectsStartedTasks(() => ownProjectIds),
    ],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  }));
});

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

describe("A Script Stage whose command isn't set, through the scripted engine", () => {
  it(
    "a Project's missing command set up by Devops in a Consultation lets Tests run again, asking the user nothing",
    async () => {
      const projectId = await aProjectWithTheTestCommandNotSet();
      ownProjectIds = [projectId];
      const pipelineId = await implementThenTests();
      const task = await aReadyTask(projectId, pipelineId);
      engine.queue(
        // Implement's first run: nothing to change yet.
        started(...turnEnded(DONE, "brief")),
        // Back from Tests: the Developer consults Devops, as Tests' failure says, and waits.
        started(
          ...officeToolCall("c-1", CONSULT_TOOL, {
            person: "Devops",
            kind: "request",
            question: "Set up the Project's test command so the Tests Stage can run.",
            why: "The Tests Stage could not run: the Project's test command isn't set yet.",
            context: "Tests ended could not run on this Task.",
          }),
          ...turnEnded({ status: "needs_decision", summary: "Asked Devops." }, "brief"),
        ),
        // Devops sets the Project up, checks the Task's branch, and answers.
        consultation(projectId),
        // Implement takes the answer in its Thread and ends done.
        resumed(...turnEnded(DONE, "work")),
      );

      await expectSent(200, "POST", `/tasks/${task.id}/start`);
      await untilState(task.id, "done");

      const stages = await stagesOf(task.id);
      expect(runsByStage(stages)).toEqual({
        // Done, then waiting on Devops' answer, then done with it.
        Implement: ["done", "needs-decision", "done"],
        Tests: ["failed", "done"],
      });
      const tests = stages.find(({ stage }) => stage.key === "tests");
      const [couldNotRun, passed] = tests?.runs ?? [];
      expect(couldNotRun?.outcome).toMatchObject({
        status: "failed",
        error: expect.stringContaining(
          `The Project's test command isn't set yet. Consult ${DEVOPS_NAME}, who holds Onboards and repairs Projects, to set it up;`,
        ),
      });
      expect(passed?.commandRuns).toContainEqual(
        expect.objectContaining({
          purpose: "command",
          commandLine: SET_COMMAND,
          outcome: "passed",
        }),
      );
      // The Project's command is set, by Devops.
      const project = projectSchema.parse(
        await (await send("GET", `/projects/${projectId}`)).json(),
      );
      expect(project.commands).toContainEqual(
        expect.objectContaining({ key: "test", commandLine: SET_COMMAND }),
      );
      // The asking Thread logs the definition Devops wrote and committed on the Task's branch.
      const threads = app.get(ThreadService);
      const logged = await Promise.all(
        (await threads.listOnTask(task.id)).map(async ({ id }) =>
          JSON.stringify(await threads.messages(id)),
        ),
      );
      expect(logged.join("\n")).toContain(
        `Run environment definition, by ${DEVOPS_NAME} (Devops): commit`,
      );
      // Devops' environment check of the Task's branch ran the set command and passed.
      const { check } = latestEnvironmentCheckSchema.parse(
        await (await send("GET", `/projects/${projectId}/environment-check`)).json(),
      );
      expect(check).toMatchObject({ taskId: task.id, state: "passed" });
      expect(check?.checks).toContainEqual(
        expect.objectContaining({ step: "command", key: "test", commandLine: SET_COMMAND }),
      );
      // Nothing was put to the user: no Decision of the Task waits on them, and none was ever theirs.
      const open = await app.get(DecisionService).listOpen();
      expect(open.filter(({ taskId }) => taskId === task.id)).toEqual([]);
      const decisions = (await threads.listOnTask(task.id)).flatMap(
        ({ openDecisions }) => openDecisions,
      );
      expect(decisions).toEqual([]);
    },
    LOOP_TEST_MS,
  );
});

/** The Devops Consultation's session: change the command, write the definition, check, answer. */
function consultation(projectId: string): SessionScript {
  return started(
    ...officeToolCall("d-1", CHANGE_PROJECT_SETTINGS_TOOL, {
      project: projectId,
      commands: {
        change: [
          {
            key: "test",
            name: "Test",
            kind: "test",
            commandLine: SET_COMMAND,
            rerunCommandLine: "",
          },
        ],
      },
      why: "The Tests Stage needs the test command.",
    }),
    ...officeToolCall("d-2", WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL, {
      files: [
        { path: ".devcontainer/devcontainer.json", text: DEVCONTAINER },
        { path: ".devcontainer/compose.yaml", text: COMPOSE },
      ],
    }),
    ...officeToolCall("d-3", RUN_ENVIRONMENT_CHECK_TOOL, {
      why: "To see the test command pass on the Task's branch.",
    }),
    ...officeToolCall("d-4", ANSWER_CONSULTATION_TOOL, {
      answers: [{ answer: "I set the test command and the run environment; the check passed." }],
    }),
    ...turnEnded(undefined, "brief"),
  );
}

const DONE = {
  status: "done",
  summary: "Done.",
  handoverNote: "Nothing is left.",
  definitionOfDoneMet: [1],
};

function started(...steps: Step[]): SessionScript {
  return [{ step: "start", brief: { id: "brief", text: "" } }, ...steps, { step: "end" }];
}

function resumed(...steps: Step[]): SessionScript {
  return [
    { step: "resume" },
    { step: "send", message: { id: "work", text: "" }, priority: "later" },
    ...steps,
    { step: "end" },
  ];
}

function turnEnded(output: unknown, consumed: string): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "completed",
        consumedMessageIds: [consumed],
        usage: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
        sessionCostUsd: 0.01,
        output,
        errors: [],
      },
    },
    { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
  ];
}

function officeToolCall(callId: string, tool: string, input: Record<string, unknown>): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool,
        officeTool: true,
        input,
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: { kind: "tool-result", callId, text: "", isError: false, withinToolCall: undefined },
    },
  ];
}

/** Sends the request and expects it `status`, showing what the service answered otherwise. */
async function expectSent(
  status: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const response = await send(method, path, body);
  // The answer's words beside its status, so a refusal says why.
  expect({ status: response.status, answer: await response.clone().text() }).toMatchObject({
    status,
  });
  return response;
}

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A Project on a repository of its own whose test command is blank, its Run environment Off. */
async function aProjectWithTheTestCommandNotSet(): Promise<string> {
  const repository = await aRepository();
  const response = await expectSent(201, "POST", "/projects", {
    name: `Loop ${randomUUID().slice(0, 8)}`,
    path: repository,
    baseBranch: "main",
    mark: { label: "LO", colour: "teal" },
    installCommand: "node --version",
    commands: [{ key: "test", name: "Test", kind: "test", commandLine: "" }],
    installInputs: ["package-lock.json"],
    publishingMode: "merge",
    defaultPipeline: "quick-fix",
    // The commands and the environment check run on the host: no container starts in a test.
    runEnvironmentAnswer: "no",
  });
  return projectSchema.parse(await response.json()).id;
}

/** Implement, by the test's Developer, then Tests, going back to Implement when it fails. */
async function implementThenTests(): Promise<string> {
  const response = await expectSent(201, "POST", "/pipelines", {
    name: `Loop ${randomUUID().slice(0, 8)}`,
    description: "Implement, then Tests.",
    stages: [
      {
        kind: "agent",
        key: "implement",
        name: "Implement",
        optional: false,
        role: developerKey,
        brief: "Make the smallest change that meets the Definition of Done.",
        session: "fresh",
        budget: 200_000,
        routes: [{ to: "tests", condition: null, limit: null }],
        place: { column: 0, row: 0 },
      },
      {
        kind: "script",
        key: "tests",
        name: "Tests",
        optional: false,
        command: "test",
        routes: [
          {
            to: "implement",
            condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
            limit: 2,
          },
          { to: null, condition: null, limit: null },
        ],
        place: { column: 1, row: 0 },
      },
    ],
  });
  return pipelineSchema.parse(await response.json()).id;
}

async function aReadyTask(projectId: string, pipelineId: string): Promise<Task> {
  const created = await send("POST", "/tasks", {
    title: "Fix the login redirect",
    projectId,
    priority: "normal",
  });
  const task = taskSchema.parse(await created.json());
  // The user writes the Plan alone, so the Planner never starts.
  await expectSent(200, "POST", `/tasks/${task.id}/planning`);
  await send("PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
  await send("PUT", `/tasks/${task.id}/definition-of-done`, { definitionOfDone: ["Mine."] });
  await send("POST", `/tasks/${task.id}/plan/confirm`);
  await send("POST", `/tasks/${task.id}/definition-of-done/confirm`);
  await send("PUT", `/tasks/${task.id}/pipeline`, { pipelineId });
  await expectSent(200, "POST", `/tasks/${task.id}/ready`);
  return task;
}

async function untilState(taskId: string, state: Task["state"]): Promise<void> {
  await vi.waitFor(
    async () => {
      const task = taskSchema.parse(await (await send("GET", `/tasks/${taskId}`)).json());
      expect(task.state).toBe(state);
    },
    { timeout: 60_000, interval: 200 },
  );
}

async function stagesOf(taskId: string): Promise<readonly TaskStage[]> {
  const stages = taskStagesSchema.parse(
    await (await send("GET", `/tasks/${taskId}/stages`)).json(),
  );
  return stages.stages ?? [];
}

function runsByStage(stages: readonly TaskStage[]): Record<string, string[]> {
  return Object.fromEntries(
    stages.map(({ stage, runs }) => [
      stage.name,
      runs.map(({ outcome }) => outcome?.status ?? "running"),
    ]),
  );
}

/** A repository whose `main` holds one file, tracking a bare `origin` beside it. */
async function aRepository(): Promise<string> {
  const repository = join(folder, "repository");
  const origin = join(folder, "origin.git");
  await mkdir(join(repository, "src"), { recursive: true });
  const git = (...args: string[]) => run("git", args, { cwd: repository });
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(repository, "src", "index.ts"), 'export const greeting = "Hello.";\n');
  await git("add", ".");
  await git("commit", "-m", "First");
  await run("git", ["clone", "--quiet", "--bare", repository, origin]);
  await git("remote", "add", "origin", origin);
  await git("fetch", "--quiet", "origin");
  await git("branch", "--quiet", "--set-upstream-to=origin/main", "main");
  return repository;
}

/**
 * The test's Developer, Devops holding its default duties, and the Planner, who holds Plans, all
 * hired.
 */
function roleCardsOf(developer: string): Partial<RoleCards> {
  const roleOf = (key: string): SessionRole => ({
    roleKey: key,
    cardVersion: 1,
    mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
    card:
      key === DEVOPS
        ? DEVOPS_CARD
        : key === PLANNER
          ? { ...DEVELOPER_CARD, name: "Jan", title: "Planner" }
          : DEVELOPER_CARD,
  });
  const hired = new Set([developer, DEVOPS, PLANNER]);
  const holderOf = (duty: DutyKey): string | undefined =>
    duty === "plans"
      ? PLANNER
      : DUTIES.some(({ key, defaultRoleKey }) => key === duty && defaultRoleKey === DEVOPS)
        ? DEVOPS
        : undefined;
  return {
    find: (key) => Promise.resolve(hired.has(key) ? roleOf(key) : undefined),
    forNewSession: (key) => Promise.resolve(roleOf(key)),
    forResumedSession: (key) => Promise.resolve(roleOf(key)),
    hiredKeys: () => Promise.resolve(hired),
    holderOf: (duty) => Promise.resolve(holderOf(duty)),
    dutyRoleKey: (duty) => Promise.resolve(holderOf(duty)),
    dutyHolders: () =>
      Promise.resolve(
        new Map(
          DUTIES.flatMap(({ key }) => {
            const holder = holderOf(key);
            return holder === undefined ? [] : [[key, holder] as const];
          }),
        ),
      ),
    consultants: () => Promise.resolve([{ roleKey: DEVOPS, name: DEVOPS_NAME, title: "Devops" }]),
    findLetGo: () => Promise.resolve(undefined),
    roleTitle: (key) => roleOf(key).card.title,
  };
}

const DEVELOPER_CARD: SessionRole["card"] = {
  name: DEVELOPER_NAME,
  title: "Developer",
  responsibilities: "Builds what the Plan says.",
  instructions: "Keep each change small.",
  engineSettings: { "claude-code": { model: null, effort: "low" } },
  capabilities: { sharedMemory: false, chat: true, consultant: false, runEnvironment: false },
  permissionProfile: { edit: true, run: "read-only-git", web: false, mcpTools: {} },
  hardSwitches: {
    runInstalls: { kind: "never" },
    publishOutsideThePipeline: { kind: "never" },
    changeRoles: { kind: "never" },
    changeProjectSettings: { kind: "never" },
  },
  taskLimit: 1,
  sessionDefault: "context-policy",
};

/** Devops, consulted, writes the run environment, and runs installs and changes settings freely. */
const DEVOPS_CARD: SessionRole["card"] = {
  ...DEVELOPER_CARD,
  name: DEVOPS_NAME,
  title: "Devops",
  responsibilities: "Onboards and repairs Projects.",
  capabilities: { sharedMemory: false, chat: true, consultant: true, runEnvironment: true },
  hardSwitches: {
    runInstalls: { kind: "allowed" },
    publishOutsideThePipeline: { kind: "never" },
    changeRoles: { kind: "never" },
    changeProjectSettings: { kind: "allowed" },
  },
};

const NO_MEMORY: Pick<MemoryService, "read"> = {
  read: () => Promise.resolve({ inUse: false, notes: [] }),
};
