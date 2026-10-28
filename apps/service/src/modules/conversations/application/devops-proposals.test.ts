import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  markLabelFor,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
  pipelineSchema,
  projectOnboardingListSchema,
  projectSchema,
  proposalSchema,
  skillSchema,
  skillUpdateDiffSchema,
  taskSchema,
  threadRefusalSchema,
  type Pipeline,
  type Project,
  type Proposal,
  type Stage,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import {
  EngineModule,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import { DEVOPS, RoleCards, type SessionRole } from "../../people/index.js";
import { SKILL_UPDATE_CHECK, SkillLibrary } from "../../skills/index.js";
import { LIST_SOURCE_SKILLS_TOOL, READ_SKILL_UPDATE_TOOL } from "../domain/session-instructions.js";
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

  it("drafts a Project to onboard; applied, it adds the Project and its Onboard Task, Ready on Onboard", async () => {
    const repository = await aRepository();
    const name = `Onboarded ${randomUUID().slice(0, 8)}`;
    const drafted = {
      name,
      path: repository,
      baseBranch: "main",
      commands: {
        install: "npm ci",
        build: "npm run build",
        lint: "npm run lint",
        test: "npm test",
      },
      installInputs: ["package-lock.json"],
      publishingMode: "push-and-pull-request",
      defaultPipeline: "quick-fix",
    };

    const [proposal] = await ninaProposes([PROPOSE_PROJECT_TOOL, drafted]);

    expect(proposal?.change).toEqual({
      kind: "project",
      project: { ...drafted, mark: { label: markLabelFor(name), colour: "teal" } },
      projectId: null,
      taskId: null,
    });
    const response = await api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    const { change } = proposalSchema.parse(await response.json());
    if (change.kind !== "project" || !change.projectId || !change.taskId) {
      throw new Error("The applied Proposal names no Project and Task.");
    }
    expect(projectSchema.parse(await read(`/projects/${change.projectId}`))).toMatchObject({
      name,
      path: repository,
      defaultPipeline: "quick-fix",
    });
    expect(taskSchema.parse(await read(`/tasks/${change.taskId}`))).toMatchObject({
      title: "Onboard",
      projectId: change.projectId,
      state: "ready",
      pipelineId: "onboard",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      createdBy: { kind: "person", roleKey: DEVOPS },
    });
    expect(projectOnboardingListSchema.parse(await read("/onboardings"))).toContainEqual({
      projectId: change.projectId,
      taskId: change.taskId,
      state: "onboarding",
    });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("refuses a Project to onboard that can't be added, which stays open and adds nothing", async () => {
    const repository = await aRepository();
    const [proposal] = await ninaProposes([
      PROPOSE_PROJECT_TOOL,
      {
        name: `Moved ${randomUUID().slice(0, 8)}`,
        path: repository,
        baseBranch: "main",
        commands: {
          install: "npm ci",
          build: "npm run build",
          lint: "npm run lint",
          test: "npm test",
        },
        installInputs: [],
        publishingMode: "merge",
        defaultPipeline: "quick-fix",
      },
    ]);
    // The repository moves away before the user applies it.
    await rm(repository, { recursive: true, force: true });
    const projectsBefore = await read("/projects");

    const response = await api("POST", `/proposals/${proposal?.id}/apply`, {});

    expect(response.status).toBe(422);
    expect((await readProposal(proposal?.id ?? "")).status.kind).toBe("open");
    expect(await read("/projects")).toEqual(projectsBefore);
  }, 30_000);
});

/** Each reads a Source with several git calls, through list, propose and apply: slow under a full run. */
const INSTALL_TEST_TIMEOUT_MS = 90_000;

describe("Devops installing a skill from a source, through the scripted engine", () => {
  it(
    "lists a source's skills and drafts installing one; applied, it is in the library at its pinned tag, off until reviewed",
    async () => {
      const name = aSkillName();
      const source = await aSource([name, aSkillName()]);

      const listed = await ninaCalls(LIST_SOURCE_SKILLS_TOOL, { source: source.url });

      expect(listed.isError).toBe(false);
      expect(JSON.parse(listed.text)).toMatchObject({
        repository: source.url,
        pinnedVersion: { tag: "v1.0.0", commit: source.commit },
        skills: expect.arrayContaining([
          {
            folder: `skills/${name}`,
            name,
            description: `Writes ${name}.`,
            files: ["SKILL.md", "scripts/run.sh"],
            filesHash: expect.any(String),
          },
        ]),
      });

      const [proposal] = await ninaProposes([
        PROPOSE_SKILL_INSTALL_TOOL,
        { source: source.url, folder: `skills/${name}` },
      ]);

      expect(proposal?.change).toEqual({
        kind: "skill-install",
        repository: source.url,
        folder: `skills/${name}`,
        pinnedVersion: { tag: "v1.0.0", commit: source.commit },
        name,
        description: `Writes ${name}.`,
        files: ["SKILL.md", "scripts/run.sh"],
        filesHash: expect.any(String),
      });
      const response = await api("POST", `/proposals/${proposal?.id}/apply`, {});
      expect(response.status).toBe(200);
      expect(skillSchema.parse(await read(`/skills/${name}`))).toMatchObject({
        name,
        source: "installed",
        installedFrom: {
          repository: source.url,
          folder: `skills/${name}`,
          pinnedVersion: { tag: "v1.0.0", commit: source.commit },
        },
        state: "waiting-for-review",
        everyone: false,
      });
    },
    INSTALL_TEST_TIMEOUT_MS,
  );

  it(
    "installs at the newest commit from a source with no tags",
    async () => {
      const name = aSkillName();
      const source = await aSource([name], { tagged: false });

      const [proposal] = await ninaProposes([
        PROPOSE_SKILL_INSTALL_TOOL,
        { source: source.url, folder: `skills/${name}` },
      ]);

      expect(proposal?.change).toMatchObject({ pinnedVersion: { commit: source.commit } });
      expect(proposal?.change).not.toHaveProperty("pinnedVersion.tag");
      const response = await api("POST", `/proposals/${proposal?.id}/apply`, {});
      expect(response.status).toBe(200);
      expect(skillSchema.parse(await read(`/skills/${name}`)).installedFrom).toEqual({
        repository: source.url,
        folder: `skills/${name}`,
        pinnedVersion: { commit: source.commit },
      });
    },
    INSTALL_TEST_TIMEOUT_MS,
  );

  it(
    "refuses drafting a skill the library has, one the source doesn't hold, and files the library refuses",
    async () => {
      const name = aSkillName();
      const source = await aSource([name], { undescribed: "skills/undescribed" });
      const written = await api("POST", "/skills", {
        name,
        description: "Mine.",
        instructions: "Do it.",
      });
      expect(written.status).toBe(201);

      const taken = await ninaCalls(PROPOSE_SKILL_INSTALL_TOOL, {
        source: source.url,
        folder: `skills/${name}`,
      });
      const missing = await ninaCalls(PROPOSE_SKILL_INSTALL_TOOL, {
        source: source.url,
        folder: "skills/other",
      });

      expect(taken).toEqual({ text: `The library already has ${name}.`, isError: true });
      expect(missing).toEqual({
        text: `${source.url} has no skill in "skills/other"; list_source_skills shows its folders.`,
        isError: true,
      });
      expect(
        await ninaCalls(PROPOSE_SKILL_INSTALL_TOOL, {
          source: source.url,
          folder: "skills/undescribed",
        }),
      ).toEqual({
        text: "SKILL.md's frontmatter gives no description: when to use it, in one sentence.",
        isError: true,
      });
    },
    INSTALL_TEST_TIMEOUT_MS,
  );

  it(
    "refuses installing once the name is taken or the source can't be read; the Proposal stays open",
    async () => {
      const taken = aSkillName();
      const gone = aSkillName();
      const source = await aSource([taken, gone]);
      const [first] = await ninaProposes([
        PROPOSE_SKILL_INSTALL_TOOL,
        { source: source.url, folder: `skills/${taken}` },
      ]);
      const [second] = await ninaProposes([
        PROPOSE_SKILL_INSTALL_TOOL,
        { source: source.url, folder: `skills/${gone}` },
      ]);
      await api("POST", "/skills", { name: taken, description: "Mine.", instructions: "Do it." });
      const refusedTaken = await api("POST", `/proposals/${first?.id}/apply`, {});
      await rm(source.folder, { recursive: true, force: true, maxRetries: 5 });
      const refusedGone = await api("POST", `/proposals/${second?.id}/apply`, {});

      expect(await reasonsOf(refusedTaken)).toEqual([`The library already has ${taken}.`]);
      const [goneReason] = await reasonsOf(refusedGone);
      expect(goneReason?.startsWith(`Could not read ${source.url}: `)).toBe(true);
      expect((await readProposal(first?.id ?? "")).status.kind).toBe("open");
      expect((await readProposal(second?.id ?? "")).status.kind).toBe("open");
      expect((await fetch(`${url}/api/skills/${gone}`)).status).toBe(404);
    },
    INSTALL_TEST_TIMEOUT_MS,
  );
});

describe("Devops updating an installed skill, through the scripted engine", () => {
  it(
    "finds the update daily, reads its diff and drafts it with notes; applied, the skill is pinned there and stays on, and a stale one is refused",
    async () => {
      const name = aSkillName();
      const source = await aSource([name]);
      await app.get(SkillLibrary, { strict: false }).install({
        repository: source.url,
        folder: `skills/${name}`,
        pinnedVersion: { tag: "v1.0.0", commit: source.commit },
      });
      expect((await api("PUT", `/skills/${name}/state`, { state: "on" })).status).toBe(200);
      const commit = await source.release("v1.1.0", {
        [`skills/${name}/SKILL.md`]: `---\ndescription: Writes ${name}.\n---\nDo it twice.\n`,
      });
      const to = { tag: "v1.1.0", commit };

      await (app.get(Schedule, { strict: false }) as ManualSchedule).runDaily(SKILL_UPDATE_CHECK);
      expect(skillSchema.parse(await read(`/skills/${name}`)).update).toEqual(to);

      const readUpdate = await ninaCalls(READ_SKILL_UPDATE_TOOL, { skill: name });
      expect(readUpdate.isError).toBe(false);
      expect(JSON.parse(readUpdate.text)).toMatchObject({
        name,
        from: { tag: "v1.0.0", commit: source.commit },
        to,
        files: ["SKILL.md", "scripts/run.sh"],
        diff: expect.stringContaining("+Do it twice."),
        diffCut: false,
      });

      const [proposal] = await ninaProposes([
        PROPOSE_SKILL_UPDATE_TOOL,
        { skill: name, notes: "Does it twice." },
      ]);
      const [stale] = await ninaProposes([
        PROPOSE_SKILL_UPDATE_TOOL,
        { skill: name, notes: "The same, again." },
      ]);
      expect(proposal?.change).toEqual({
        kind: "skill-update",
        name,
        repository: source.url,
        folder: `skills/${name}`,
        from: { tag: "v1.0.0", commit: source.commit },
        to,
        notes: "Does it twice.",
        files: ["SKILL.md", "scripts/run.sh"],
        filesHash: expect.any(String),
      });
      const diff = skillUpdateDiffSchema.parse(
        await read(`/skills/${name}/update-diff?tag=v1.1.0&commit=${commit}`),
      );
      expect(diff.diff).toContain("--- a/SKILL.md");
      expect(diff.diff).toContain("-Do it.\n+Do it twice.");

      expect((await api("POST", `/proposals/${proposal?.id}/apply`, {})).status).toBe(200);
      const updated = skillSchema.parse(await read(`/skills/${name}`));
      expect(updated).toMatchObject({ version: 2, state: "on" });
      expect(updated.installedFrom?.pinnedVersion).toEqual(to);
      expect(updated.update).toBeUndefined();

      expect(await reasonsOf(await api("POST", `/proposals/${stale?.id}/apply`, {}))).toEqual([
        `${name} is pinned at v1.1.0 now, not at v1.0.0 as this update was proposed from.`,
      ]);
      expect((await readProposal(stale?.id ?? "")).status.kind).toBe("open");
      expect(await ninaCalls(PROPOSE_SKILL_UPDATE_TOOL, { skill: name, notes: "More." })).toEqual({
        text: `${name} is pinned at v1.1.0, the newest version of ${source.url}.`,
        isError: true,
      });
    },
    INSTALL_TEST_TIMEOUT_MS * 2,
  );
});

/** What Nina read back from one Office tool she called in her chat. */
async function ninaCalls(
  tool: string,
  input: Record<string, unknown>,
): Promise<{ readonly text: string; readonly isError: boolean }> {
  const sessionsBefore = engine.sessions.length;
  engine.queue([
    { step: "start", brief: { id: "brief", text: "" } },
    ...toolCall("c-0", tool, input),
    ...endsTurn("Done."),
  ]);
  const started = await app.get(ThreadService, { strict: false }).startInChat(DEVOPS);
  await app.get(ThreadRunner, { strict: false }).send(started.id, "Look at this source, please.");
  return vi.waitFor(
    () => {
      const result = engine.sessions
        .slice(sessionsBefore)
        .flatMap((session) => session.reportedEvents)
        .find((event) => event.kind === "tool-result");
      if (!result) throw new Error("No Office tool answered yet.");
      return { text: result.text, isError: result.isError };
    },
    // The tools read the Source with several git calls, slow under a full run.
    { timeout: 25_000, interval: 20 },
  );
}

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
    // Installing a skill reads its Source with several git calls, slow under a full run.
    { timeout: 25_000, interval: 20 },
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
  [PROPOSE_PROJECT_TOOL]: "project",
  [PROPOSE_SKILL_INSTALL_TOOL]: "skill-install",
  [PROPOSE_SKILL_UPDATE_TOOL]: "skill-update",
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

/** A repository of the test's own with one commit on main. */
async function aRepository(): Promise<string> {
  const repository = await mkdtemp(join(folder, "repository-"));
  await run("git", ["init", "--initial-branch=main"], { cwd: repository });
  await writeFile(join(repository, "README.md"), "Devops' Proposals.\n");
  await run("git", ["add", "."], { cwd: repository });
  await run(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "First"],
    { cwd: repository },
  );
  return repository;
}

/** A skill name of the test's own, since every test file shares the database. */
function aSkillName(): string {
  return `installed-${randomUUID().slice(0, 8)}`;
}

interface SourceForTest {
  readonly url: string;
  readonly folder: string;
  readonly commit: string;
  /** Writes the files at their paths, commits, tags the commit and pushes both; its id. */
  release(tag: string, files: Readonly<Record<string, string>>): Promise<string>;
}

/**
 * A Source of the test's own: a bare repository with a skill in `skills/<name>` for each name,
 * tagged v1.0.0 unless `tagged` is false, and a skill with no description in `undescribed` when
 * given; reached by a file URL so the test never uses the network.
 */
async function aSource(
  names: readonly string[],
  { tagged = true, undescribed }: { readonly tagged?: boolean; readonly undescribed?: string } = {},
): Promise<SourceForTest> {
  const checkout = await mkdtemp(join(folder, "source-"));
  const git = (...gitArguments: string[]) =>
    run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...gitArguments], {
      cwd: checkout,
    });
  await git("init", "--initial-branch=main");
  for (const name of names) {
    await mkdir(join(checkout, "skills", name, "scripts"), { recursive: true });
    await writeFile(
      join(checkout, "skills", name, "SKILL.md"),
      `---\ndescription: Writes ${name}.\n---\nDo it.\n`,
    );
    await writeFile(join(checkout, "skills", name, "scripts", "run.sh"), "#!/bin/sh\n");
  }
  if (undescribed !== undefined) {
    await mkdir(join(checkout, ...undescribed.split("/")), { recursive: true });
    await writeFile(
      join(checkout, ...undescribed.split("/"), "SKILL.md"),
      "---\nlicense: MIT\n---\nDo it.\n",
    );
  }
  await git("add", ".");
  await git("commit", "-m", "Skills");
  if (tagged) await git("tag", "--annotate", "--message", "First", "v1.0.0");
  const bare = `${checkout}.git`;
  await run("git", ["clone", "--bare", "--quiet", checkout, bare]);
  const head = async () =>
    (await run("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim();
  return {
    url: pathToFileURL(bare).href,
    folder: bare,
    commit: await head(),
    async release(tag, files) {
      for (const [path, content] of Object.entries(files)) {
        await writeFile(join(checkout, ...path.split("/")), content);
      }
      await git("commit", "--all", "-m", tag);
      await git("tag", "--annotate", "--message", tag, tag);
      await git("push", "--quiet", bare, "main", `refs/tags/${tag}`);
      return head();
    },
  };
}

async function reasonsOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return threadRefusalSchema.parse(await response.json()).reasons;
}

/** A Project of the test's own, on a repository of its own. */
async function aProject(): Promise<Project> {
  const repository = await aRepository();
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
