import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  pipelineSchema,
  projectSchema,
  proposalSchema,
  type Pipeline,
  type Project,
  type Proposal,
  type Stage,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import {
  EngineModule,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import { DEVOPS, RoleCards, type SessionRole } from "../../people/index.js";
import { ProposalService } from "./proposal-service.js";
import { ThreadRunner } from "./thread-runner.js";
import { ThreadService } from "./thread-service.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { aPlannerCard } from "./session-role.fixtures.js";

const run = promisify(execFile);

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

// Devops is hired from a preset under its fixed key, which only roles.controller.test may hire into
// (apps/service/docs/testing.md): People's RoleCards stand in for Nina here.
const NINA: SessionRole = {
  roleKey: DEVOPS,
  cardVersion: 1,
  card: aPlannerCard({ name: "Nina", title: "Devops" }),
};

const ROLE_CARDS: Partial<RoleCards> = {
  find: (key) => Promise.resolve(key === DEVOPS ? NINA : undefined),
  forNewSession: () => Promise.resolve(NINA),
  forResumedSession: () => Promise.resolve(NINA),
  hiredKeys: () => Promise.resolve(new Set([DEVOPS])),
  consultants: () => Promise.resolve([]),
  findLetGo: () => Promise.resolve(undefined),
};

let folder: string;
let app: INestApplication;
let url: string;
let engine: ScriptedEngine;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-devops-proposals-"));
  engine = new ScriptedEngine([]);
  ({ app, url } = await startTestApplication({
    imports: [
      AppModule.register(
        {
          port: 0,
          databaseUrl: testDatabaseUrl(),
          officeDataDirectory: join(folder, "office-data"),
        },
        { directory: folder, source: "built" },
      ),
    ],
    // Nina's Memory is People's, kept by her Role, which the stand-in above has no row for.
    overrides: [{ provide: RoleCards, useValue: ROLE_CARDS }, sessionMemoryProvider()],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  }));
});

afterAll(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

describe("Devops' Proposals, through the scripted engine", () => {
  it("drafts a Project's commands and a library Pipeline's Stages from a chat, each applied with a click", async () => {
    const project = await aProject();
    const pipeline = await aPipeline();
    const stages = withLint(pipeline.stages);

    const drafted = await ninaProposes(
      [
        PROPOSE_PROJECT_COMMANDS_TOOL,
        {
          project: project.id,
          change: {
            test: "npm run test:all",
            lint: project.commands.lint,
            installInputs: [".nvmrc"],
          },
        },
      ],
      [PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: pipeline.id, stages }],
    );

    expect(drafted.map(({ change }) => change)).toEqual([
      {
        kind: "project-commands",
        projectId: project.id,
        from: { test: "npm test", installInputs: ["package-lock.json"] },
        to: { test: "npm run test:all", installInputs: [".nvmrc"] },
      },
      { kind: "pipeline", pipelineId: pipeline.id, from: pipeline.stages, to: stages },
    ]);
    for (const { id } of drafted) {
      const response = await api("POST", `/proposals/${id}/apply`, {});
      expect(response.status).toBe(200);
      expect(proposalSchema.parse(await response.json()).status.kind).toBe("applied");
    }
    expect(projectSchema.parse(await read(`/projects/${project.id}`))).toMatchObject({
      commands: { ...project.commands, test: "npm run test:all" },
      installInputs: [".nvmrc"],
    });
    expect(pipelineSchema.parse(await read(`/pipelines/${pipeline.id}`))).toEqual({
      ...pipeline,
      stages,
    });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("refuses a Proposal whose values changed since it was drafted, which stays open and changes nothing", async () => {
    const project = await aProject();
    const pipeline = await aPipeline();
    const drafted = await ninaProposes(
      [PROPOSE_PROJECT_COMMANDS_TOOL, { project: project.id, change: { test: "vitest run" } }],
      [PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: pipeline.id, stages: withLint(pipeline.stages) }],
    );
    // The user edits both by hand first.
    await api("PUT", `/projects/${project.id}/commands/test`, { commandLine: "npm run check" });
    const edited = pipelineSchema.parse(
      await (
        await api("PUT", `/pipelines/${pipeline.id}`, {
          name: pipeline.name,
          description: pipeline.description,
          stages: pipeline.stages.slice(0, 1),
        })
      ).json(),
    );

    const reasons = [
      "The test command changed since this was proposed.",
      `${pipeline.name}'s Stages changed since this was proposed.`,
    ];
    for (const [index, proposal] of drafted.entries()) {
      const response = await api("POST", `/proposals/${proposal.id}/apply`, {});
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ reasons: [reasons[index]] });
      expect((await readProposal(proposal.id)).status.kind).toBe("open");
    }
    expect(projectSchema.parse(await read(`/projects/${project.id}`)).commands.test).toBe(
      "npm run check",
    );
    expect(pipelineSchema.parse(await read(`/pipelines/${pipeline.id}`))).toEqual(edited);
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);
});

/** Nina, asked in her chat, calls each Office tool with its input in one turn. */
async function ninaProposes(
  ...calls: readonly (readonly [string, Record<string, unknown>])[]
): Promise<readonly Proposal[]> {
  engine.queue([
    { step: "start", brief: { id: "brief", text: "" } },
    ...calls.flatMap(([tool, input], index) => toolCall(`c-${index}`, tool, input)),
    ...endsTurn("Here are the cards."),
  ]);
  const threads = app.get(ThreadService, { strict: false });
  const started = await threads.startInChat(DEVOPS);
  await app.get(ThreadRunner, { strict: false }).send(started.id, "Tidy up the commands, please.");
  const proposals = app.get(ProposalService, { strict: false });
  // The scripted turn may end before its Office tools finish drafting.
  const drafted = await vi.waitFor(
    async () => {
      const inThread = await proposals.listInThread(started.id);
      if (inThread.length < calls.length) throw new Error("Still drafting.");
      return inThread;
    },
    { timeout: 10_000, interval: 20 },
  );
  const stored = await Promise.all(drafted.map(({ id }) => readProposal(id)));
  // In the order of the calls, whatever order the tools finished in.
  return calls.map(([tool]) => {
    const proposal = stored.find(({ change }) => change.kind === KIND_OF_TOOL[tool]);
    if (!proposal) throw new Error(`${tool} drafted nothing.`);
    return proposal;
  });
}

const KIND_OF_TOOL: Readonly<Record<string, Proposal["change"]["kind"]>> = {
  [PROPOSE_PROJECT_COMMANDS_TOOL]: "project-commands",
  [PROPOSE_LIBRARY_PIPELINE_TOOL]: "pipeline",
};

async function readProposal(id: string): Promise<Proposal> {
  return proposalSchema.parse(await read(`/proposals/${id}`));
}

function toolCall(callId: string, tool: string, input: Record<string, unknown>): Step[] {
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
    { step: "event", event: { kind: "tool-result", callId, text: "", isError: false } },
  ];
}

function endsTurn(text: string): Step[] {
  return [
    { step: "event", event: { kind: "text", text, withinToolCall: undefined } },
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "completed",
        consumedMessageIds: ["brief"],
        usage: USAGE,
        sessionCostUsd: 0.01,
        output: undefined,
        errors: [],
      },
    },
    { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
  ];
}

/** A Project of the test's own, on a repository of its own with one commit on main. */
async function aProject(): Promise<Project> {
  const repository = await mkdtemp(join(folder, "repository-"));
  await run("git", ["init", "--initial-branch=main"], { cwd: repository });
  await writeFile(join(repository, "README.md"), "Devops' Proposals.\n");
  await run("git", ["add", "."], { cwd: repository });
  await run(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "First"],
    { cwd: repository },
  );
  const response = await api("POST", "/projects", {
    name: `Devops ${randomUUID().slice(0, 8)}`,
    path: repository,
    baseBranch: "main",
    mark: { label: "DV", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: ["package-lock.json"],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "quick-fix",
  });
  expect(response.status).toBe(201);
  return projectSchema.parse(await response.json());
}

/** A library Pipeline of the test's own: the shared database's built-ins stay as they are. */
async function aPipeline(): Promise<Pipeline> {
  const quickFix = pipelineSchema.parse(await read("/pipelines/quick-fix"));
  const response = await api("POST", "/pipelines", {
    name: `Nightly ${randomUUID().slice(0, 8)}`,
    description: "For the nightly run.",
    stages: quickFix.stages,
  });
  expect(response.status).toBe(201);
  return pipelineSchema.parse(await response.json());
}

/** The Stages with a Lint Stage before the last. */
function withLint(stages: readonly Stage[]): Stage[] {
  const lint: Stage = {
    kind: "script",
    key: "lint",
    name: "Lint",
    optional: false,
    command: "lint",
  };
  return [...stages.slice(0, -1), lint, ...stages.slice(-1)];
}

async function read(path: string): Promise<unknown> {
  const response = await fetch(`${url}/api${path}`);
  expect(response.status).toBe(200);
  return response.json();
}

function api(method: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
