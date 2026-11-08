import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  markLabelFor,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_TOOL,
  pipelineSchema,
  projectListSchema,
  projectOnboardingListSchema,
  projectSchema,
  proposalSchema,
  skillReviewSchema,
  skillSchema,
  taskSchema,
  type Pipeline,
  type Project,
  type Stage,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../../engine/index.js";
import { DEVOPS, EngineCascade, RoleCards } from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { ownProjectsStartedTasks } from "../../pipelines/index.fixtures.js";
import { TaskWorktrees } from "../../projects/index.js";
import { SkillLibrary } from "../../skills/index.js";
import { ownProjectsQueue } from "../../work/index.fixtures.js";
import {
  DevopsChat,
  NINA_ROLE_CARDS,
  noProjectBases,
} from "../adapters/http/devops-chat.fixtures.js";
import { ProjectBases } from "../ports/project-bases.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";

// Devops installing and updating skills from a Source is devops-skill-sources.test.ts.

const run = promisify(execFile);

let folder: string;
let app: INestApplication;
let url: string;
let chat: DevopsChat;

/** The whole app boots for each test: slow under a full run. */
const BOOT_TIMEOUT_MS = 30_000;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-devops-proposals-"));
  // The test's own, as DevopsChat says.
  const engine = new ScriptedEngine([]);
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
      { provide: RoleCards, useValue: NINA_ROLE_CARDS },
      { provide: EngineCascade, useValue: new EngineCascadeStandIn() },
      // Nina's Memory is People's, kept by her Role, which the stand-in above has no row for.
      sessionMemoryProvider(),
      // A chat reads every Project's base branch, which would run git in other test files' own
      // repositories on the shared database while they use or delete them; no test here needs it.
      { provide: ProjectBases, useValue: noProjectBases(join(folder, "bases")) },
      // The queue and the started Tasks every file shares: this file queues nothing and walks only
      // what it starts, so neither its releases nor its start touch other files' Tasks.
      ownProjectsQueue(),
      ownProjectsStartedTasks(),
    ],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  }));
  chat = new DevopsChat(app, url, engine);
}, BOOT_TIMEOUT_MS);

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

describe("Devops' Proposals, through the scripted engine", () => {
  it("drafts a Project's commands and a library Pipeline's Stages from a chat, each applied with a click", async () => {
    const project = await aProject();
    const pipeline = await aPipeline();
    const stages = withLint(pipeline.stages);

    const drafted = await chat.ninaProposes(
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
      const response = await chat.api("POST", `/proposals/${id}/apply`, {});
      expect(response.status).toBe(200);
      expect(proposalSchema.parse(await response.json()).status.kind).toBe("applied");
    }
    expect(projectSchema.parse(await chat.read(`/projects/${project.id}`))).toMatchObject({
      commands: { ...project.commands, test: "npm run test:all" },
      installInputs: [".nvmrc"],
    });
    expect(pipelineSchema.parse(await chat.read(`/pipelines/${pipeline.id}`))).toEqual({
      ...pipeline,
      stages,
    });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("refuses a Proposal whose values changed since it was drafted, which stays open and changes nothing", async () => {
    const project = await aProject();
    const pipeline = await aPipeline();
    const drafted = await chat.ninaProposes(
      [PROPOSE_PROJECT_COMMANDS_TOOL, { project: project.id, change: { test: "vitest run" } }],
      [PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: pipeline.id, stages: withLint(pipeline.stages) }],
    );
    // The user edits both by hand first.
    await chat.api("PUT", `/projects/${project.id}/commands/test`, {
      commandLine: "npm run check",
    });
    const edited = pipelineSchema.parse(
      await (
        await chat.api("PUT", `/pipelines/${pipeline.id}`, {
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
      const response = await chat.api("POST", `/proposals/${proposal.id}/apply`, {});
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ reasons: [reasons[index]] });
      expect((await chat.readProposal(proposal.id)).status.kind).toBe("open");
    }
    expect(projectSchema.parse(await chat.read(`/projects/${project.id}`)).commands.test).toBe(
      "npm run check",
    );
    expect(pipelineSchema.parse(await chat.read(`/pipelines/${pipeline.id}`))).toEqual(edited);
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

    const [proposal] = await chat.ninaProposes([PROPOSE_PROJECT_TOOL, drafted]);

    expect(proposal?.change).toEqual({
      kind: "project",
      project: { ...drafted, mark: { label: markLabelFor(name), colour: "teal" } },
      projectId: null,
      taskId: null,
    });
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    const { change } = proposalSchema.parse(await response.json());
    if (change.kind !== "project" || !change.projectId || !change.taskId) {
      throw new Error("The applied Proposal names no Project and Task.");
    }
    expect(projectSchema.parse(await chat.read(`/projects/${change.projectId}`))).toMatchObject({
      name,
      path: repository,
      defaultPipeline: "quick-fix",
      // Asked at its first Start: the Proposal carries no answer.
      runEnvironment: "not-decided",
    });
    expect(taskSchema.parse(await chat.read(`/tasks/${change.taskId}`))).toMatchObject({
      title: "Onboard",
      projectId: change.projectId,
      state: "ready",
      pipelineId: "onboard",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      createdBy: { kind: "person", roleKey: DEVOPS },
    });
    expect(projectOnboardingListSchema.parse(await chat.read("/onboardings"))).toContainEqual({
      projectId: change.projectId,
      taskId: change.taskId,
      state: "onboarding",
    });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("applied again after its Onboard Task failed, carries on with the Project already added", async () => {
    const repository = await aRepository();
    const name = `Retried ${randomUUID().slice(0, 8)}`;
    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_TOOL,
      {
        name,
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
    vi.spyOn(app.get(TaskWorktrees, { strict: false }), "open").mockRejectedValueOnce(
      new Error("No space left on the disk."),
    );

    const refused = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(refused.status).toBe(422);
    expect(await chat.reasonsOf(refused)).toEqual([
      `${name} is added, but its Onboard Task isn't: The Onboard Task's worktree couldn't be made: No space left on the disk.`,
    ]);
    expect((await chat.readProposal(proposal?.id ?? "")).status.kind).toBe("open");

    const applied = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(applied.status).toBe(200);
    const { change } = proposalSchema.parse(await applied.json());
    if (change.kind !== "project" || !change.projectId || !change.taskId) {
      throw new Error("The applied Proposal names no Project and Task.");
    }
    const projects = projectListSchema.parse(await chat.read("/projects"));
    expect(projects.filter((project) => project.path === repository)).toMatchObject([
      { id: change.projectId, name },
    ]);
    expect(projectOnboardingListSchema.parse(await chat.read("/onboardings"))).toContainEqual({
      projectId: change.projectId,
      taskId: change.taskId,
      state: "onboarding",
    });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("refuses a Project to onboard that can't be added, which stays open and adds nothing", async () => {
    const repository = await aRepository();
    const name = `Moved ${randomUUID().slice(0, 8)}`;
    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_TOOL,
      {
        name,
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

    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});

    expect(response.status).toBe(422);
    expect((await chat.readProposal(proposal?.id ?? "")).status.kind).toBe("open");
    // Only this Project: other test files add theirs to the shared database meanwhile.
    const projects = projectListSchema.parse(await chat.read("/projects"));
    expect(
      projects.filter((project) => project.name === name || project.path === repository),
    ).toEqual([]);
  }, 30_000);

  it("drafts a Project to onboard by its Repository URL; applied, it is cloned, then added with its Onboard Task", async () => {
    const restoreGitConfig = onMadeUpHost(await aBareRepository("shop.git"));
    try {
      const name = `Cloned ${randomUUID().slice(0, 8)}`;
      const repositoryUrl = `${MADE_UP_HOST}shop`;
      const clonePath = join(
        folder,
        "office-data",
        "repositories",
        "git.example.test",
        "acme",
        "shop",
      );

      const [proposal] = await chat.ninaProposes([
        PROPOSE_PROJECT_TOOL,
        { ...ONBOARDED, name, url: repositoryUrl },
      ]);

      expect(proposal?.change).toEqual({
        kind: "project",
        project: {
          ...ONBOARDED,
          name,
          path: clonePath,
          repositoryUrl,
          mark: { label: markLabelFor(name), colour: "teal" },
        },
        projectId: null,
        taskId: null,
      });
      // The dry run reads the remote's branches only: nothing is cloned before the user applies it.
      expect(await stat(clonePath).catch(() => undefined)).toBeUndefined();
      const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
      expect(response.status).toBe(200);
      const { change } = proposalSchema.parse(await response.json());
      if (change.kind !== "project" || !change.projectId || !change.taskId) {
        throw new Error("The applied Proposal names no Project and Task.");
      }
      expect(projectSchema.parse(await chat.read(`/projects/${change.projectId}`))).toMatchObject({
        name,
        path: clonePath,
        repositoryUrl,
        baseBranch: "main",
      });
      expect((await stat(join(clonePath, "README.md"))).isFile()).toBe(true);
      expect(taskSchema.parse(await chat.read(`/tasks/${change.taskId}`))).toMatchObject({
        title: "Onboard",
        projectId: change.projectId,
        pipelineId: "onboard",
      });
    } finally {
      restoreGitConfig();
    }
    // The whole app, a clone and a chat session: slow under a full run.
  }, 30_000);

  it("refuses a Project to onboard by its Repository URL without the base branch on the remote, cloning nothing", async () => {
    const restoreGitConfig = onMadeUpHost(await aBareRepository("store.git"));
    try {
      const answer = await chat.ninaCalls(PROPOSE_PROJECT_TOOL, {
        ...ONBOARDED,
        name: `Branchless ${randomUUID().slice(0, 8)}`,
        url: `${MADE_UP_HOST}store`,
        baseBranch: "develop",
      });

      expect(answer).toEqual({
        text: expect.stringContaining('The repository has no branch "develop".'),
        isError: true,
      });
      expect(
        await stat(join(folder, "office-data", "repositories")).catch(() => undefined),
      ).toBeUndefined();
    } finally {
      restoreGitConfig();
    }
  }, 30_000);
});

/** A Project Devops drafts to onboard, without its repository's path or URL. */
const ONBOARDED = {
  baseBranch: "main",
  commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
  installInputs: [],
  publishingMode: "merge",
  defaultPipeline: "quick-fix",
};

/** A made-up host, whose repositories are the bare ones in the test's folder. */
const MADE_UP_HOST = "https://git.example.test/acme/";

/**
 * Git config, as the user's global config could hold it, that reads a URL on the made-up host as
 * the bare repository of that name beside `bareRepository`, since a Repository URL is never a
 * local path; undone by the function it returns.
 */
function onMadeUpHost(bareRepository: string): () => void {
  const variables = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${join(bareRepository, "..").replaceAll("\\", "/")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: MADE_UP_HOST,
  };
  Object.assign(process.env, variables);
  return () => {
    for (const name of Object.keys(variables)) delete process.env[name];
  };
}

/** A bare copy of a repository of the test's own, named `name` in the test's folder. */
async function aBareRepository(name: string): Promise<string> {
  const bare = join(folder, name);
  await run("git", ["clone", "--quiet", "--bare", await aRepository(), bare]);
  return bare;
}

// Anyone drafts a written skill in their chat; Nina's chat stands in for everyone's here.
describe("A skill drafted as a Proposal in a chat, through the scripted engine", () => {
  it("drafts a written skill; applied, it is in the library as written, off until reviewed", async () => {
    const name = aDraftedSkillName();
    const [proposal] = await chat.ninaProposes([
      PROPOSE_SKILL_TOOL,
      {
        name: ` ${name} `,
        description: " Writes the release notes. ",
        instructions: "List each change under its kind.",
      },
    ]);

    expect(proposal?.change).toEqual({
      kind: "skill",
      name,
      description: "Writes the release notes.",
      instructions: "List each change under its kind.",
    });
    expect((await fetch(`${url}/api/skills/${name}`)).status).toBe(404);
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    expect(skillReviewSchema.parse(await chat.read(`/skills/${name}/review`))).toMatchObject({
      skill: {
        name,
        description: "Writes the release notes.",
        source: "written",
        state: "waiting-for-review",
        everyone: false,
      },
      instructions: expect.stringContaining("List each change under its kind."),
    });
  }, 30_000);

  it("refuses drafting a skill the library refuses, with every reason, and one whose name is taken", async () => {
    const taken = aDraftedSkillName();
    const written = await chat.api("POST", "/skills", {
      name: taken,
      description: "Mine.",
      instructions: "Do it.",
    });
    expect(written.status).toBe(201);

    const broken = await chat.ninaCalls(PROPOSE_SKILL_TOOL, {
      name: "Release Notes",
      description: "Writes them.",
      instructions: " ",
    });
    const named = await chat.ninaCalls(PROPOSE_SKILL_TOOL, {
      name: taken,
      description: "Yours.",
      instructions: "Do it.",
    });

    expect(broken.isError).toBe(true);
    expect(broken.text).toContain("A skill's name is lowercase letters and digits");
    expect(broken.text).toContain("Give the skill its instructions.");
    expect(named).toEqual({
      text: expect.stringContaining(`The library already has ${taken}.`),
      isError: true,
    });
  }, 30_000);

  it("refuses applying once the name is taken; the Proposal stays open", async () => {
    const name = aDraftedSkillName();
    const [proposal] = await chat.ninaProposes([
      PROPOSE_SKILL_TOOL,
      { name, description: "Writes them.", instructions: "Do it." },
    ]);
    await app.get(SkillLibrary, { strict: false }).write({
      name,
      description: "Mine.",
      instructions: "Mine.",
    });

    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});

    expect(response.status).toBe(422);
    expect(await chat.reasonsOf(response)).toEqual([`The library already has ${name}.`]);
    expect((await chat.readProposal(proposal?.id ?? "")).status.kind).toBe("open");
    expect(skillSchema.parse(await chat.read(`/skills/${name}`)).description).toBe("Mine.");
  }, 30_000);
});

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

/** A drafted skill's name of the test's own, as above. */
function aDraftedSkillName(): string {
  return `drafted-${randomUUID().slice(0, 8)}`;
}

/** A Project of the test's own, on a repository of its own. */
async function aProject(): Promise<Project> {
  const repository = await aRepository();
  const response = await chat.api("POST", "/projects", {
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
  const quickFix = pipelineSchema.parse(await chat.read("/pipelines/quick-fix"));
  const response = await chat.api("POST", "/pipelines", {
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
