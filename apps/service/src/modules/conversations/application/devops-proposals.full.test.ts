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
  PROPOSE_PROJECT_PIPELINE_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  pipelineListSchema,
  pipelineSchema,
  projectListSchema,
  projectOnboardingListSchema,
  projectPipelineSchema,
  projectSchema,
  proposalSchema,
  skillReviewSchema,
  skillSchema,
  stageTemplateListSchema,
  stageTemplateSchema,
  taskSchema,
  type Pipeline,
  type Project,
  type ProjectPipeline,
  type Stage,
  type StageTemplate,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../../engine/index.js";
import { EngineCascade, RoleCards } from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { ownProjectsStartedTasks } from "../../pipelines/index.fixtures.js";
import { TaskWorktrees } from "../../projects/index.js";
import { SkillLibrary } from "../../skills/index.js";
import { ownProjectsQueue } from "../../work/index.fixtures.js";
import { DevopsChat, NINA_DUTIES, NINA_ROLE_CARDS } from "../adapters/http/devops-chat.fixtures.js";
import { LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL } from "../domain/session-instructions.js";
import { ProjectBases } from "../ports/project-bases.js";
import { noProjectBases } from "../ports/project-bases.fixtures.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";

/** The Role holding Onboards and repairs Projects by default. */
const DEVOPS = "devops";

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
      NINA_DUTIES,
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
    const stages = narrowedToTest(withLint(pipeline.stages));

    const drafted = await chat.ninaProposes(
      [
        PROPOSE_PROJECT_COMMANDS_TOOL,
        {
          project: project.id,
          change: {
            installInputs: [".nvmrc"],
            commands: [
              { key: "test", name: "Test", kind: "test", commandLine: "npm run test:all" },
              { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
              { key: "test-e2e", name: "End to end", kind: "test", commandLine: "npm run e2e" },
            ],
            removeCommands: ["build"],
          },
        },
      ],
      [PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: pipeline.id, stages }],
    );

    expect(drafted.map(({ change }) => change)).toEqual([
      {
        kind: "project-commands",
        projectId: project.id,
        changes: {
          installInputs: { from: ["package-lock.json"], to: [".nvmrc"] },
          commands: [
            {
              key: "test",
              from: { name: "Test", kind: "test", commandLine: "npm test" },
              to: { name: "Test", kind: "test", commandLine: "npm run test:all" },
            },
            {
              key: "test-e2e",
              from: null,
              to: { name: "End to end", kind: "test", commandLine: "npm run e2e" },
            },
            {
              key: "build",
              from: { name: "Build", kind: "build", commandLine: "npm run build" },
              to: null,
            },
          ],
        },
      },
      { kind: "pipeline", pipelineId: pipeline.id, from: pipeline.stages, to: stages },
    ]);
    for (const { id } of drafted) {
      const response = await chat.api("POST", `/proposals/${id}/apply`, {});
      expect(response.status).toBe(200);
      expect(proposalSchema.parse(await response.json()).status.kind).toBe("applied");
    }
    expect(projectSchema.parse(await chat.read(`/projects/${project.id}`))).toMatchObject({
      commands: [
        { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
        { key: "test", name: "Test", kind: "test", commandLine: "npm run test:all" },
        { key: "test-e2e", name: "End to end", kind: "test", commandLine: "npm run e2e" },
      ],
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
      [
        PROPOSE_PROJECT_COMMANDS_TOOL,
        {
          project: project.id,
          change: {
            commands: [{ key: "test", name: "Test", kind: "test", commandLine: "vitest run" }],
          },
        },
      ],
      [PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: pipeline.id, stages: withLint(pipeline.stages) }],
    );
    // The user edits both by hand first.
    await chat.api("PUT", `/projects/${project.id}/commands/test`, {
      name: "Test",
      kind: "test",
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
    expect(
      projectSchema.parse(await chat.read(`/projects/${project.id}`)).commands[2]?.commandLine,
    ).toBe("npm run check");
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
      installCommand: "npm ci",
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
        { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
        { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
      ],
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
        installCommand: "npm ci",
        commands: [
          { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
          { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
          { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
        ],
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
        installCommand: "npm ci",
        commands: [
          { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
          { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
          { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
        ],
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
  installCommand: "npm ci",
  commands: [
    { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
    { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
    { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
  ],
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

describe("Devops' Proposals of a Stage template, through the scripted engine", () => {
  it("lists the Stage templates in the shape the propose tool takes them", async () => {
    const template = await aStageTemplate();

    const listed = await chat.ninaCalls(LIST_STAGE_TEMPLATES_TOOL, {});

    expect(listed.isError).toBe(false);
    const { templates, duties } = JSON.parse(listed.text) as {
      templates: unknown;
      duties: unknown;
    };
    expect(stageTemplateListSchema.parse(templates)).toContainEqual(template);
    // The built-in templates name duties, each with its holder or nobody.
    expect(duties).toMatchObject({ implements: expect.stringMatching(/^Implements \(/) });
  }, 30_000);

  it("drafts a template's new Stage from a chat, changing nothing until it is applied with a click", async () => {
    const template = await aStageTemplate();
    const stage = { ...template.stage, brief: "Review the change, then the tests it touched." };

    const [proposal] = await chat.ninaProposes([
      PROPOSE_STAGE_TEMPLATE_TOOL,
      { template: template.id, stage },
    ]);

    expect(proposal?.change).toEqual({
      kind: "stage-template",
      templateId: template.id,
      from: template.stage,
      to: stage,
    });
    expect(await aTemplateNow(template.id)).toEqual(template);
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    expect(proposalSchema.parse(await response.json()).status.kind).toBe("applied");
    expect(await aTemplateNow(template.id)).toEqual({ id: template.id, stage });
    // The whole app and a chat session: slow under a full run.
  }, 30_000);

  it("refuses drafting for an unknown template and for a Stage a template save refuses", async () => {
    const template = await aStageTemplate();
    const other = await aStageTemplate();

    const unknown = await chat.ninaCalls(PROPOSE_STAGE_TEMPLATE_TOOL, {
      template: "no-such-template",
      stage: template.stage,
    });
    const refused = await chat.ninaCalls(PROPOSE_STAGE_TEMPLATE_TOOL, {
      template: template.id,
      stage: { ...template.stage, name: other.stage.name, role: " " },
    });

    expect(unknown).toEqual({
      text: 'There is no Stage template "no-such-template".',
      isError: true,
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`Another Stage template is named "${other.stage.name}".`);
    expect(refused.text).toContain("Choose who works it.");
    expect(await aTemplateNow(template.id)).toEqual(template);
  }, 30_000);

  it("refuses applying once the template changed since it was drafted; the Proposal stays open", async () => {
    const template = await aStageTemplate();
    const [proposal] = await chat.ninaProposes([
      PROPOSE_STAGE_TEMPLATE_TOOL,
      { template: template.id, stage: { ...template.stage, budget: 200_000 } },
    ]);
    // The user edits it by hand first.
    const edited = stageTemplateSchema.parse(
      await (
        await chat.api("PUT", `/stage-templates/${template.id}`, {
          stage: { ...template.stage, budget: 50_000 },
        })
      ).json(),
    );

    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});

    expect(await chat.reasonsOf(response)).toEqual([
      `The ${template.stage.name} Stage template changed since this was proposed.`,
    ]);
    expect((await chat.readProposal(proposal?.id ?? "")).status.kind).toBe("open");
    expect(await aTemplateNow(template.id)).toEqual(edited);
  }, 30_000);
});

describe("Devops' Proposals of a Project Pipeline, through the scripted engine", () => {
  it("lists the office-wide Pipelines, then each Project Pipeline in the shape the propose tool takes", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const projectPipeline = await aProjectPipeline(project, base);

    const listed = await chat.ninaCalls(LIST_PIPELINES_TOOL, { project: project.id });

    expect(listed.isError).toBe(false);
    const { officeWidePipelines, projectPipelines } = JSON.parse(listed.text) as {
      officeWidePipelines: unknown;
      projectPipelines: unknown;
    };
    expect(pipelineListSchema.parse(officeWidePipelines)).toContainEqual(base);
    expect(projectPipelines).toEqual([
      {
        id: projectPipeline.id,
        project: { id: project.id, name: project.name },
        name: projectPipeline.name,
        description: "Then lint.",
        basePipeline: { id: base.id, name: base.name },
        stageChanges: projectPipeline.stageChanges,
        stages: projectPipeline.stages,
        broken: [],
      },
    ]);
  }, 30_000);

  it("drafts a new one, which applied is added under its id; the Project's default stays", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const name = `Quick with lint ${randomUUID().slice(0, 8)}`;

    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_PIPELINE_TOOL,
      {
        project: project.id,
        name,
        basePipeline: base.id,
        stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: LINT }],
      },
    ]);

    const to = {
      name,
      description: "",
      basePipelineId: base.id,
      stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: LINT }],
    };
    expect(proposal?.change).toEqual({
      kind: "project-pipeline",
      projectId: project.id,
      pipelineId: null,
      from: null,
      to,
    });
    expect(await projectPipelinesOf(project)).toEqual([]);
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    const applied = proposalSchema.parse(await response.json());
    const [added] = await projectPipelinesOf(project);
    expect(applied.change).toEqual({ ...proposal?.change, pipelineId: added?.id });
    expect(added).toMatchObject({ name, basePipeline: { id: base.id }, broken: [] });
    expect(added?.stages.map(({ key }) => key)).toEqual(["implement", "tests", "lint", "publish"]);
    expect(projectSchema.parse(await chat.read(`/projects/${project.id}`)).defaultPipeline).toBe(
      "quick-fix",
    );
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("drafts a change, the fields left out kept, which applied saves the Project Pipeline whole", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const projectPipeline = await aProjectPipeline(project, base);
    const stageChanges = [
      ...projectPipeline.stageChanges,
      { kind: "change", stageKey: "implement", fields: { brief: "Implement it, then lint." } },
    ];

    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_PIPELINE_TOOL,
      { project: project.id, pipeline: projectPipeline.id, stageChanges },
    ]);

    const from = {
      name: projectPipeline.name,
      description: "Then lint.",
      basePipelineId: base.id,
      stageChanges: projectPipeline.stageChanges,
    };
    expect(proposal?.change).toEqual({
      kind: "project-pipeline",
      projectId: project.id,
      pipelineId: projectPipeline.id,
      from,
      to: { ...from, stageChanges },
    });
    expect(await aProjectPipelineNow(projectPipeline.id)).toEqual(projectPipeline);
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    const saved = await aProjectPipelineNow(projectPipeline.id);
    expect(saved.stageChanges).toEqual([
      ...projectPipeline.stageChanges,
      { ...stageChanges[1], stageName: "Implement" },
    ]);
    expect(saved.stages[0]).toMatchObject({ key: "implement", brief: "Implement it, then lint." });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("refuses applying once the Project Pipeline changed since it was drafted; the Proposal stays open", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const projectPipeline = await aProjectPipeline(project, base);
    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_PIPELINE_TOOL,
      { project: project.id, pipeline: projectPipeline.id, description: "Lint, then publish." },
    ]);
    // The user edits it by hand first.
    const edited = projectPipelineSchema.parse(
      await (
        await chat.api("PUT", `/project-pipelines/${projectPipeline.id}`, {
          name: projectPipeline.name,
          description: "Edited by hand.",
          basePipelineId: base.id,
          stageChanges: projectPipeline.stageChanges,
        })
      ).json(),
    );

    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});

    expect(await chat.reasonsOf(response)).toEqual([
      `${projectPipeline.name} changed since this was proposed.`,
    ]);
    expect((await chat.readProposal(proposal?.id ?? "")).status.kind).toBe("open");
    expect(await aProjectPipelineNow(projectPipeline.id)).toEqual(edited);
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("refuses drafting for the editor's reasons, an unknown Project, and a change that changes nothing", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const projectPipeline = await aProjectPipeline(project, base);

    const taken = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: project.id,
      name: base.name,
      basePipeline: "no-such-pipeline",
    });
    const missingKey = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: project.id,
      pipeline: projectPipeline.id,
      stageChanges: [{ kind: "remove", stageKey: "no-such-stage" }],
    });
    const unknownProject = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: "no-such-project",
      name: "Mine",
      basePipeline: base.id,
    });
    const nothing = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: project.id,
      pipeline: projectPipeline.id,
      name: projectPipeline.name,
    });

    expect(taken.isError).toBe(true);
    expect(taken.text).toContain(`"${base.name}"`);
    expect(taken.text).toContain(
      'There is no office-wide Pipeline "no-such-pipeline" to build it from.',
    );
    expect(missingKey).toMatchObject({ isError: true });
    expect(missingKey.text).toContain("Removes no-such-stage, which isn't among the Stages.");
    expect(unknownProject).toMatchObject({ isError: true });
    expect(unknownProject.text).toContain('There is no Project "no-such-project".');
    expect(nothing).toMatchObject({ isError: true });
    expect(nothing.text).toContain("Nothing changes");
    expect(await projectPipelinesOf(project)).toEqual([projectPipeline]);
    // The whole app, a real repository and four chat sessions: slow under a full run.
  }, 60_000);

  it("answers a library Pipeline's Proposal with the Project Pipelines its Stages would break", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const projectPipeline = await aProjectPipeline(project, base);
    const withoutTests = base.stages.filter(({ key }) => key !== "tests");

    const answer = await chat.ninaCalls(PROPOSE_LIBRARY_PIPELINE_TOOL, {
      pipeline: base.id,
      stages: withoutTests,
    });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("Applying it leaves these Project Pipelines Broken");
    expect(answer.text).toContain(
      `- ${project.name}'s ${projectPipeline.name}: Inserts Lint after Tests, which ${base.name} no longer has.`,
    );
    expect(await aProjectPipelineNow(projectPipeline.id)).toEqual(projectPipeline);
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);
});

/** A Lint Stage, the Project's lint command. */
const LINT: Stage = { kind: "script", key: "lint", name: "Lint", optional: false, command: "lint" };

/** A Project Pipeline of the Project, built from `base` with Lint inserted after Tests. */
async function aProjectPipeline(project: Project, base: Pipeline): Promise<ProjectPipeline> {
  const response = await chat.api("POST", "/project-pipelines", {
    projectId: project.id,
    name: `${base.name} with lint`,
    description: "Then lint.",
    basePipelineId: base.id,
    stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: LINT }],
  });
  expect(response.status).toBe(201);
  return projectPipelineSchema.parse(await response.json());
}

async function aProjectPipelineNow(id: string): Promise<ProjectPipeline> {
  return projectPipelineSchema.parse(await chat.read(`/project-pipelines/${id}`));
}

async function projectPipelinesOf(project: Project): Promise<ProjectPipeline[]> {
  return projectPipelineSchema
    .array()
    .parse(await chat.read(`/project-pipelines?projectId=${project.id}`));
}

/** A Stage template of the test's own: the shared database's built-ins stay as they are. */
async function aStageTemplate(): Promise<StageTemplate> {
  const response = await chat.api("POST", "/stage-templates", {
    stage: {
      kind: "agent",
      key: "review",
      name: `Review ${randomUUID().slice(0, 8)}`,
      role: "developer",
      brief: "Review the change.",
      session: "fresh",
      budget: 100_000,
      optional: false,
    },
  });
  expect(response.status).toBe(201);
  return stageTemplateSchema.parse(await response.json());
}

async function aTemplateNow(id: string): Promise<StageTemplate> {
  return stageTemplateSchema.parse(await chat.read(`/stage-templates/${id}`));
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
    installCommand: "npm ci",
    commands: [
      { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
      { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
      { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
    ],
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

/** The Stages with each Agent Stage keeping only the Project's test command. */
function narrowedToTest(stages: readonly Stage[]): Stage[] {
  return stages.map((stage) =>
    stage.kind === "agent"
      ? { ...stage, permissions: { ...stage.permissions, commands: ["test"] } }
      : stage,
  );
}
