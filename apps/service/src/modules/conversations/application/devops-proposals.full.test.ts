import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import {
  actionListSchema,
  markLabelFor,
  PROPOSE_ACTIONS_TOOL,
  offBoardTaskStartSchema,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_PROJECT_PIPELINE_TOOL,
  PROPOSE_PROJECT_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  PROPOSE_TEST_TARGETS_TOOL,
  pipelineListSchema,
  pipelineSchema,
  projectListSchema,
  projectOnboardingListSchema,
  projectPipelineSchema,
  projectSchema,
  projectSettingChangesSchema,
  projectTestTargetsChatSchema,
  proposalSchema,
  skillReviewSchema,
  skillSchema,
  stageTemplateListSchema,
  stageTemplateSchema,
  taskSchema,
  testTargetListSchema,
  type Action,
  type Pipeline,
  type Project,
  type ProjectPipeline,
  type Stage,
  type StageTemplate,
  type ProjectTestTargetsChat,
  type TestTarget,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";
import { SIGNED_IN_FOR_TESTS } from "../../../platform/http/signed-in-requests.fixtures.js";
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
import { ThreadService } from "./thread-service.js";

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
              from: { name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
              to: {
                name: "Test",
                kind: "test",
                commandLine: "npm run test:all",
                rerunCommandLine: "",
              },
            },
            {
              key: "test-e2e",
              from: null,
              to: {
                name: "End to end",
                kind: "test",
                commandLine: "npm run e2e",
                rerunCommandLine: "",
              },
            },
            {
              key: "build",
              from: {
                name: "Build",
                kind: "build",
                commandLine: "npm run build",
                rerunCommandLine: "",
              },
              to: null,
            },
          ],
        },
      },
      {
        kind: "pipeline",
        pipelineId: pipeline.id,
        from: pipeline.stages,
        to: expect.any(Array),
        routes: expect.objectContaining({ stages: expect.any(Array) }),
      },
    ]);
    // Drafted as the straight line the plain list stands for.
    const [, pipelineDraft] = drafted;
    if (pipelineDraft?.change.kind !== "pipeline") throw new Error("A Pipeline's Proposal.");
    expect(asPlainList(pipelineDraft.change.to)).toEqual(stages);
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
    // Projects records the change as the Proposal's, applied by the signed-in user.
    const [commandsDraft] = drafted;
    expect(
      projectSettingChangesSchema.parse(await chat.read(`/projects/${project.id}/setting-changes`))
        .changes,
    ).toEqual([
      expect.objectContaining({
        setting: "commands",
        summary: "changed Commands",
        by: {
          kind: "proposal",
          proposalId: commandsDraft?.id,
          user: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
        },
      }),
    ]);
    // Read back as the straight line the library converted the plain list to.
    const saved = pipelineSchema.parse(await chat.read(`/pipelines/${pipeline.id}`));
    expect(saved).toEqual({ ...pipeline, stages: expect.any(Array) });
    expect(asPlainList(saved.stages)).toEqual(stages);
    expect(saved.stages.map(({ routes }) => routes?.map(({ to }) => to))).toEqual([
      ["tests"],
      ["lint"],
      ["publish"],
      [null],
    ]);
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it('drafts "run Review only when Tests changed files or ended Failed, otherwise Publish"; applied it saves the flow, declined it changes nothing', async () => {
    const pipeline = await aPipeline();
    // Review comes just before Publish in the Pipeline's order and stands where Publish stood,
    // which moves on by a card and its gap.
    const reviewWhenNeeded: Stage[] = pipeline.stages.flatMap((stage): Stage[] => {
      if (stage.key === "tests") return [{ ...stage, routes: REVIEW_WHEN_TESTS_CHANGED_OR_FAILED }];
      if (stage.key !== "publish" || !stage.position) return [stage];
      const { x, y } = stage.position;
      return [
        { ...REVIEW, routes: [{ to: "publish", condition: null }], position: { x, y } },
        { ...stage, position: { x: x + 308, y } },
      ];
    });

    const proposing = [
      PROPOSE_LIBRARY_PIPELINE_TOOL,
      { pipeline: pipeline.id, stages: reviewWhenNeeded },
    ] as const;
    const [declined] = await chat.ninaProposes(proposing);
    const [applied] = await chat.ninaProposes(proposing);
    if (applied?.change.kind !== "pipeline" || !declined) throw new Error("Two Proposals.");

    // Quick fix's Tests goes back to Implement on failure, which the Proposal leaves out; every
    // route given without a limit leads on, so takes No limit.
    const toPublish = { to: "publish", toName: "Publish", condition: null, limit: null };
    expect(applied.change.routes?.stages).toEqual([
      {
        stageKey: "tests",
        stageName: "Tests",
        from: [
          {
            to: "implement",
            toName: "Implement",
            condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
            limit: 2,
          },
          toPublish,
        ],
        to: [
          { ...REVIEW_WHEN_TESTS_CHANGED_OR_FAILED[0], toName: "Review", limit: null },
          toPublish,
        ],
      },
      { stageKey: "review", stageName: "Review", from: [], to: [toPublish] },
    ]);
    const declinedResponse = await chat.api("POST", `/proposals/${declined.id}/decline`, {});
    expect(declinedResponse.status).toBe(200);
    expect(pipelineSchema.parse(await chat.read(`/pipelines/${pipeline.id}`))).toEqual(pipeline);
    const appliedResponse = await chat.api("POST", `/proposals/${applied.id}/apply`, {});
    expect(appliedResponse.status).toBe(200);
    const saved = pipelineSchema.parse(await chat.read(`/pipelines/${pipeline.id}`));
    // Quick fix's conflict chain stays as it was, on its row under Publish.
    expect(saved.stages.map(({ key }) => key)).toEqual([
      "implement",
      "office:resolve",
      "tests",
      "office:resolve-test",
      "review",
      "publish",
    ]);
    expect(saved.stages.find(({ key }) => key === "publish")?.routes?.map(({ to }) => to)).toEqual([
      "office:resolve",
      null,
    ]);
    expect(saved.stages.find(({ key }) => key === "tests")?.routes).toEqual(
      applied.change.routes?.stages[0]?.to,
    );
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
          stages: asPlainList(pipeline.stages).slice(0, 1),
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

  it("drafts a Project to onboard; applied, it adds the Project and starts its Onboard Task on Onboard", async () => {
    const repository = await aRepository();
    const name = `Onboarded ${randomUUID().slice(0, 8)}`;
    const drafted = {
      name,
      path: repository,
      baseBranch: "main",
      installCommand: "npm ci",
      commands: [
        {
          key: "build",
          name: "Build",
          kind: "build",
          commandLine: "npm run build",
          rerunCommandLine: "",
        },
        {
          key: "lint",
          name: "Lint",
          kind: "lint",
          commandLine: "npm run lint",
          rerunCommandLine: "",
        },
        { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
      ],
      installInputs: ["package-lock.json"],
      publishingMode: "push-and-pull-request",
      defaultPipeline: "quick-fix",
    };

    const [proposal] = await chat.ninaProposes([PROPOSE_PROJECT_TOOL, drafted]);

    expect(proposal?.change).toEqual({
      kind: "project",
      project: { ...drafted, mark: { label: markLabelFor(name), colour: "teal" } },
      features: [],
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
      // The Proposal carries no answer, so it is added Off.
      runEnvironment: "off",
    });
    const task = taskSchema.parse(await chat.read(`/tasks/${change.taskId}`));
    expect(task).toMatchObject({
      title: "Onboard",
      projectId: change.projectId,
      pipelineId: "onboard",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      madeFor: "onboard",
      createdBy: { kind: "person", roleKey: DEVOPS },
    });
    // An Off-board Task: started at once, never left Ready for the user's Start.
    expect(task.state).not.toBe("ready");
    expect(projectOnboardingListSchema.parse(await chat.read("/onboardings"))).toContainEqual({
      projectId: change.projectId,
      taskId: change.taskId,
      state: "onboarding",
    });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("drafts a Project to onboard with its feature switches; applied, the Project is added with them", async () => {
    const repository = await aRepository();
    const name = `Switched ${randomUUID().slice(0, 8)}`;
    const features = {
      "github-issues": { on: false, reason: "Its issues are tracked elsewhere." },
      "connected-devices": { on: true, reason: "An Android app." },
      "test-targets": { on: false, reason: "A library, with nothing to try by hand." },
    };

    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_TOOL,
      { ...ONBOARDED, name, path: repository, features },
    ]);

    // In the features' order, whatever order they were given in.
    expect(proposal?.change).toMatchObject({
      kind: "project",
      features: [
        { feature: "connected-devices", on: true, reason: "An Android app." },
        { feature: "test-targets", on: false, reason: "A library, with nothing to try by hand." },
        { feature: "github-issues", on: false, reason: "Its issues are tracked elsewhere." },
      ],
    });
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    const { change } = proposalSchema.parse(await response.json());
    if (change.kind !== "project" || !change.projectId) {
      throw new Error("The applied Proposal names no Project.");
    }
    expect(change.features).toHaveLength(3);
    const project = projectSchema.parse(await chat.read(`/projects/${change.projectId}`));
    expect(project.features).toEqual({
      // Proposed on, and stored, but read off while the Project's Run environment is Off.
      "connected-devices": false,
      // Off as proposed, where a Project added without them reads them on.
      "test-targets": false,
      "github-issues": false,
      "run-environment": false,
      // Not among those proposed, so on, as for any Project added.
      actions: true,
    });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("applied with its Onboard Task's start refused, adds the Project alone, which Onboard starts later", async () => {
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

    const applied = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(applied.status).toBe(200);
    const { change } = proposalSchema.parse(await applied.json());
    if (change.kind !== "project" || !change.projectId) {
      throw new Error("The applied Proposal names no Project.");
    }
    expect(change.taskId).toBeNull();
    const projects = projectListSchema.parse(await chat.read("/projects"));
    expect(projects.filter((project) => project.path === repository)).toMatchObject([
      { id: change.projectId, name },
    ]);
    const onboardings = projectOnboardingListSchema.parse(await chat.read("/onboardings"));
    expect(onboardings.filter(({ projectId }) => projectId === change.projectId)).toEqual([]);

    const onboard = await chat.api("POST", `/projects/${change.projectId}/onboard`, {});
    expect(onboard.status).toBe(200);
    const started = offBoardTaskStartSchema.parse(await onboard.json());
    if (started.outcome === "refused") throw new Error(started.reasons.join(" "));
    expect(projectOnboardingListSchema.parse(await chat.read("/onboardings"))).toContainEqual({
      projectId: change.projectId,
      taskId: started.offBoardTask.taskId,
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
        features: [],
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
    {
      key: "build",
      name: "Build",
      kind: "build",
      commandLine: "npm run build",
      rerunCommandLine: "",
    },
    { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint", rerunCommandLine: "" },
    { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
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
        copiedFrom: projectPipeline.copiedFrom,
        stages: projectPipeline.stages,
      },
    ]);
  }, 30_000);

  it("drafts a new one copied from a Pipeline, which applied is added under its id; the Project's default stays", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const name = `Quick with lint ${randomUUID().slice(0, 8)}`;

    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_PIPELINE_TOOL,
      { project: project.id, name, copyOf: base.id, stages: withLint(base.stages) },
    ]);

    expect(proposal?.change).toEqual({
      kind: "project-pipeline",
      projectId: project.id,
      pipelineId: null,
      from: null,
      to: { name, description: "", copyOf: base.id, stages: expect.any(Array) },
      routes: expect.objectContaining({ stages: expect.any(Array) }),
    });
    expect(await projectPipelinesOf(project)).toEqual([]);
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    const applied = proposalSchema.parse(await response.json());
    const [added] = await projectPipelinesOf(project);
    expect(applied.change).toEqual({ ...proposal?.change, pipelineId: added?.id });
    expect(added).toMatchObject({
      name,
      copiedFrom: { name: base.name },
      brokenBeforeUpdate: null,
    });
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
    const stages = projectPipeline.stages.map((stage) =>
      stage.kind === "agent" && stage.key === "implement"
        ? { ...stage, brief: "Implement it, then lint." }
        : stage,
    );

    const [proposal] = await chat.ninaProposes([
      PROPOSE_PROJECT_PIPELINE_TOOL,
      { project: project.id, pipeline: projectPipeline.id, stages },
    ]);

    const from = {
      name: projectPipeline.name,
      description: "Then lint.",
      stages: projectPipeline.stages,
    };
    expect(proposal?.change).toEqual({
      kind: "project-pipeline",
      projectId: project.id,
      pipelineId: projectPipeline.id,
      from,
      to: { ...from, stages: expect.any(Array) },
      routes: expect.objectContaining({ stages: [] }),
    });
    expect(await aProjectPipelineNow(projectPipeline.id)).toEqual(projectPipeline);
    const response = await chat.api("POST", `/proposals/${proposal?.id}/apply`, {});
    expect(response.status).toBe(200);
    const saved = await aProjectPipelineNow(projectPipeline.id);
    expect(saved.stages.map(({ key }) => key)).toEqual(["implement", "tests", "lint", "publish"]);
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
          stages: projectPipeline.stages,
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

  it("refuses drafting for the editor's reasons, an unknown Pipeline to copy, an unknown Project, and a change that changes nothing", async () => {
    const project = await aProject();
    const base = await aPipeline();
    const projectPipeline = await aProjectPipeline(project, base);

    const taken = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: project.id,
      name: base.name,
      copyOf: base.id,
    });
    const unknownCopy = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: project.id,
      name: "Mine",
      copyOf: "no-such-pipeline",
    });
    const brokenRule = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: project.id,
      pipeline: projectPipeline.id,
      stages: projectPipeline.stages.map((stage) =>
        stage.key === "tests" ? { ...stage, routes: [] } : stage,
      ),
    });
    const unknownProject = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: "no-such-project",
      name: "Mine",
      copyOf: base.id,
    });
    const nothing = await chat.ninaCalls(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: project.id,
      pipeline: projectPipeline.id,
      name: projectPipeline.name,
    });

    expect(taken.isError).toBe(true);
    expect(taken.text).toContain(`"${base.name}"`);
    expect(unknownCopy).toMatchObject({ isError: true });
    expect(unknownCopy.text).toContain('There is no Pipeline "no-such-pipeline" to copy');
    expect(brokenRule).toMatchObject({ isError: true });
    expect(brokenRule.text).toContain("Tests: give it a route out");
    expect(unknownProject).toMatchObject({ isError: true });
    expect(unknownProject.text).toContain('There is no Project "no-such-project".');
    expect(nothing).toMatchObject({ isError: true });
    expect(nothing.text).toContain("Nothing changes");
    expect(await projectPipelinesOf(project)).toEqual([projectPipeline]);
    // The whole app, a real repository and five chat sessions: slow under a full run.
  }, 60_000);
});

describe("Devops' Proposals of test targets, through the scripted engine", () => {
  const WEB = {
    key: "web",
    name: "Web app",
    kind: "hosted",
    entryPoint: {
      kind: "package-script",
      manifest: "package.json",
      script: "start",
      arguments: [],
    },
    port: 5173,
    portVariable: "PORT",
    variables: [{ name: "MODE", value: "test" }],
    secretVariables: [],
    commandsBefore: [],
    memoryMegabytes: null,
  } as const;
  const ANDROID = {
    key: "android",
    name: "Android",
    kind: "build-to-install",
    entryPoint: {
      kind: "package-script",
      manifest: "package.json",
      script: "build",
      arguments: [],
    },
    outputPatterns: ["dist/*.apk"],
    variables: [],
    secretVariables: ["SIGNING_KEY"],
    commandsBefore: ["build"],
    memoryMegabytes: 1024,
  } as const;

  it("drafts test targets that change nothing until applied, a value the user set only when named, and applies them as set by the Proposal", async () => {
    const project = await aProject(await aRepositoryWithScripts());
    await putTargets(project, [WEB]);
    const before = await targetsOf(project);

    const unnamed = await chat.ninaCalls(PROPOSE_TEST_TARGETS_TOOL, {
      project: project.id,
      targets: [{ ...WEB, port: 3000 }],
    });
    expect(unnamed.isError).toBe(true);
    expect(unnamed.text).toContain("The user set web.port");

    const refused = await chat.ninaCalls(PROPOSE_TEST_TARGETS_TOOL, {
      project: project.id,
      targets: [{ ...ANDROID, commandsBefore: ["seed"], memoryMegabytes: 700 }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(
      `Test target "android": The command seed in its commands before the entry point isn't one of the Project's commands.`,
    );
    expect(refused.text).toContain(
      `Test target "android": Its memory per service is between 0.5 GB and 64 GB, in steps of 0.5 GB.`,
    );

    const [drafted] = await chat.ninaProposes([
      PROPOSE_TEST_TARGETS_TOOL,
      {
        project: project.id,
        targets: [{ ...WEB, port: 3000 }, ANDROID],
        changeUserSet: ["web.port"],
      },
    ]);
    if (!drafted) throw new Error("A Proposal of test targets.");
    expect(drafted.change).toEqual({
      kind: "test-targets",
      projectId: project.id,
      changes: {
        targets: [
          { key: "web", from: WEB, to: { ...WEB, port: 3000 }, userSet: ["port"] },
          { key: "android", from: null, to: ANDROID, userSet: [] },
        ],
      },
    });
    expect(await targetsOf(project)).toEqual(before);

    const applied = await chat.api("POST", `/proposals/${drafted.id}/apply`, {});
    expect(applied.status).toBe(200);
    const setter = {
      by: "proposal",
      proposalId: drafted.id,
      agent: { roleKey: DEVOPS, name: "Nina" },
    };
    const [web, android] = await targetsOf(project);
    expect(web).toMatchObject({ port: 3000, setBy: { port: setter, name: { by: "user" } } });
    expect(android).toMatchObject({
      key: "android",
      secretVariables: [{ name: "SIGNING_KEY", valueSet: false }],
      commandsBefore: ["build"],
      memoryMegabytes: 1024,
      setBy: {
        name: setter,
        entryPoint: setter,
        outputPatterns: setter,
        commandsBefore: setter,
        memoryMegabytes: setter,
      },
    });
    // The whole app, a real repository and two chat sessions: slow under a full run.
  }, 60_000);

  it("refuses to apply test targets whose values changed since they were drafted, changing nothing", async () => {
    const project = await aProject(await aRepositoryWithScripts());
    await putTargets(project, [WEB]);
    const [drafted] = await chat.ninaProposes([
      PROPOSE_TEST_TARGETS_TOOL,
      { project: project.id, targets: [{ ...WEB, port: 3000 }], changeUserSet: ["web.port"] },
    ]);
    if (!drafted) throw new Error("A Proposal of test targets.");
    await putTargets(project, [{ ...WEB, port: 8080 }]);
    const before = await targetsOf(project);

    const applied = await chat.api("POST", `/proposals/${drafted.id}/apply`, {});

    expect(await chat.reasonsOf(applied)).toEqual([
      `Test target "web" changed since this was proposed.`,
    ]);
    expect(await targetsOf(project)).toEqual(before);
    expect((await chat.readProposal(drafted.id)).status.kind).toBe("open");
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("asks Nina in a titled chat with no message sent, follows it to its Proposal, and ends it once applied", async () => {
    const project = await aProject(await aRepositoryWithScripts());
    expect(await testTargetsChatOf(project)).toEqual({ chat: null, setUpTask: null });

    const asked = await askForTestTargets(project);
    const first = asked.chat;
    expect(asked).toEqual({
      chat: {
        threadId: expect.any(String),
        roleKey: DEVOPS,
        state: "draft",
        since: expect.any(String),
      },
      setUpTask: null,
    });
    if (!first) throw new Error("A chat.");
    const threads = app.get(ThreadService, { strict: false });
    expect(await threads.read(first.threadId)).toMatchObject({
      home: { kind: "chat", roleKey: DEVOPS },
      title: `Set up test targets: ${project.name}`,
      state: "waiting",
    });
    expect(await threads.messages(first.threadId)).toEqual([]);

    // Ask again, while no Proposal is open: a new Thread the card follows from now.
    const again = (await askForTestTargets(project)).chat;
    expect(again?.threadId).not.toBe(first.threadId);
    expect((await testTargetsChatOf(project)).chat?.threadId).toBe(again?.threadId);
    if (!again) throw new Error("A chat asked again.");

    const [drafted] = await chat.ninaProposesIn(again.threadId, [
      PROPOSE_TEST_TARGETS_TOOL,
      { project: project.id, targets: [WEB] },
    ]);
    if (!drafted) throw new Error("A Proposal of test targets.");
    await vi.waitFor(async () => {
      expect((await testTargetsChatOf(project)).chat).toEqual({
        threadId: again.threadId,
        roleKey: DEVOPS,
        state: "proposal",
        since: drafted.draftedAt,
      });
    });

    const refused = await chat.api("POST", `/projects/${project.id}/test-targets/chat`, {});
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      reasons: ["The test targets Proposal in the chat is still open: apply or dismiss it first."],
    });

    const applied = await chat.api("POST", `/proposals/${drafted.id}/apply`, {});
    expect(applied.status).toBe(200);
    expect(await testTargetsChatOf(project)).toEqual({ chat: null, setUpTask: null });
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);
});

describe("Devops' Proposals of Actions, through the scripted engine", () => {
  const BUILD = {
    key: "build-web",
    name: "Build web",
    leavesTheWorkstation: false,
    kind: "project-command",
    settings: {
      commandKey: "build",
      commandsBefore: ["install"],
      timeLimitMinutes: null,
      projectDeviceId: null,
    },
  } as const;
  const LINT = {
    key: "lint",
    name: "Lint",
    leavesTheWorkstation: false,
    kind: "project-command",
    settings: {
      commandKey: "lint",
      commandsBefore: [],
      timeLimitMinutes: 10,
      projectDeviceId: null,
    },
  } as const;

  it("drafts Actions that change nothing until applied, a value the user set only when named, and applies them as set by the Proposal", async () => {
    const project = await aProject();
    await putActions(project, [BUILD]);
    const before = await actionsOf(project);

    const unnamed = await chat.ninaCalls(PROPOSE_ACTIONS_TOOL, {
      project: project.id,
      actions: [{ ...BUILD, name: "Build the web app" }],
    });
    expect(unnamed.isError).toBe(true);
    expect(unnamed.text).toContain("The user set build-web.name");

    const refused = await chat.ninaCalls(PROPOSE_ACTIONS_TOOL, {
      project: project.id,
      actions: [{ ...LINT, settings: { ...LINT.settings, commandKey: "deploy" } }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("deploy");

    const [drafted] = await chat.ninaProposes([
      PROPOSE_ACTIONS_TOOL,
      {
        project: project.id,
        actions: [{ ...BUILD, name: "Build the web app" }, LINT],
        changeUserSet: ["build-web.name"],
      },
    ]);
    if (!drafted) throw new Error("A Proposal of Actions.");
    expect(drafted.change).toEqual({
      kind: "actions",
      projectId: project.id,
      changes: {
        actions: [
          {
            key: "build-web",
            from: BUILD,
            to: { ...BUILD, name: "Build the web app" },
            userSet: ["name"],
          },
          { key: "lint", from: null, to: LINT, userSet: [] },
        ],
      },
    });
    expect(await actionsOf(project)).toEqual(before);

    const applied = await chat.api("POST", `/proposals/${drafted.id}/apply`, {});
    expect(applied.status).toBe(200);
    const setter = setterOf(drafted.id);
    const [build, lint] = await actionsOf(project);
    expect(build).toMatchObject({
      name: "Build the web app",
      setBy: { name: setter, settings: { by: "user" } },
    });
    expect(lint).toMatchObject({
      ...LINT,
      setBy: { name: setter, kind: setter, settings: setter },
    });
    // The whole app, a real repository and three chat sessions: slow under a full run.
  }, 60_000);

  it("refuses to apply Actions whose values changed since they were drafted, changing nothing", async () => {
    const project = await aProject();
    await putActions(project, [BUILD]);
    const [drafted] = await chat.ninaProposes([
      PROPOSE_ACTIONS_TOOL,
      {
        project: project.id,
        actions: [{ ...BUILD, name: "Build the web app" }],
        changeUserSet: ["build-web.name"],
      },
    ]);
    if (!drafted) throw new Error("A Proposal of Actions.");
    await putActions(project, [
      { ...BUILD, settings: { ...BUILD.settings, timeLimitMinutes: 30 } },
    ]);
    const before = await actionsOf(project);

    const applied = await chat.api("POST", `/proposals/${drafted.id}/apply`, {});

    expect(await chat.reasonsOf(applied)).toEqual([
      `Action "build-web" changed since this was proposed.`,
    ]);
    expect(await actionsOf(project)).toEqual(before);
    expect((await chat.readProposal(drafted.id)).status.kind).toBe("open");
    // The whole app, a real repository and a chat session: slow under a full run.
  }, 30_000);

  it("marks an Action Leaves the workstation by a Proposal, and refuses one that clears the mark", async () => {
    const project = await aProject();
    await putActions(project, [BUILD, { ...LINT, leavesTheWorkstation: true }]);

    const cleared = await chat.ninaCalls(PROPOSE_ACTIONS_TOOL, {
      project: project.id,
      actions: [LINT],
      changeUserSet: ["lint.leavesTheWorkstation"],
    });
    expect(cleared.isError).toBe(true);
    expect(cleared.text).toContain(
      `Action "lint": A Proposal may mark an Action Leaves the workstation, never clear the mark; only the user clears it.`,
    );

    const [drafted] = await chat.ninaProposes([
      PROPOSE_ACTIONS_TOOL,
      {
        project: project.id,
        actions: [{ ...BUILD, leavesTheWorkstation: true }],
        changeUserSet: ["build-web.leavesTheWorkstation"],
      },
    ]);
    if (!drafted) throw new Error("A Proposal of Actions.");
    expect(drafted.change).toMatchObject({
      kind: "actions",
      changes: { actions: [{ key: "build-web", userSet: ["leavesTheWorkstation"] }] },
    });

    const applied = await chat.api("POST", `/proposals/${drafted.id}/apply`, {});
    expect(applied.status).toBe(200);
    const [build, lint] = await actionsOf(project);
    expect(build).toMatchObject({
      leavesTheWorkstation: true,
      setBy: { leavesTheWorkstation: setterOf(drafted.id), name: { by: "user" } },
    });
    expect(lint).toMatchObject({ leavesTheWorkstation: true });
    // The whole app, a real repository and two chat sessions: slow under a full run.
  }, 60_000);

  it("refuses drafting and applying Actions while the Project has them switched off", async () => {
    const project = await aProject();
    const [drafted] = await chat.ninaProposes([
      PROPOSE_ACTIONS_TOOL,
      { project: project.id, actions: [BUILD] },
    ]);
    if (!drafted) throw new Error("A Proposal of Actions.");
    const off = await chat.api("PUT", `/projects/${project.id}/features`, {
      features: { actions: false },
    });
    expect(off.status).toBe(200);
    const switchedOff = `Actions are switched off for «${project.name}».`;

    const applied = await chat.api("POST", `/proposals/${drafted.id}/apply`, {});
    expect(await chat.reasonsOf(applied)).toEqual([switchedOff]);
    expect((await chat.readProposal(drafted.id)).status.kind).toBe("open");

    const refused = await chat.ninaCalls(PROPOSE_ACTIONS_TOOL, {
      project: project.id,
      actions: [LINT],
    });
    expect(refused).toEqual({ text: expect.stringContaining(switchedOff), isError: true });
    expect(await actionsOf(project)).toEqual([]);
    // The whole app, a real repository and two chat sessions: slow under a full run.
  }, 60_000);
});

/** Who set a value an applied Proposal of Nina's changed. */
function setterOf(proposalId: string) {
  return { by: "proposal", proposalId, agent: { roleKey: DEVOPS, name: "Nina" } };
}

/** Saves the Project's Actions as the user does on the Project page. */
async function putActions(project: Project, actions: readonly unknown[]): Promise<void> {
  const response = await chat.api("PUT", `/projects/${project.id}/actions`, { actions });
  expect(response.status).toBe(200);
}

async function actionsOf(project: Project): Promise<Action[]> {
  return actionListSchema.parse(await chat.read(`/projects/${project.id}/actions`)).actions;
}

async function testTargetsChatOf(project: Project): Promise<ProjectTestTargetsChat> {
  return projectTestTargetsChatSchema.parse(
    await chat.read(`/projects/${project.id}/test-targets/chat`),
  );
}

async function askForTestTargets(project: Project): Promise<ProjectTestTargetsChat> {
  const response = await chat.api("POST", `/projects/${project.id}/test-targets/chat`, {});
  if (response.status !== 200) throw new Error(await response.text());
  return projectTestTargetsChatSchema.parse(await response.json());
}

/** A repository as aRepository's, with a package manifest whose scripts test targets name. */
async function aRepositoryWithScripts(): Promise<string> {
  const repository = await aRepository();
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ name: "web", scripts: { start: "vite", build: "vite build" } }),
  );
  await run("git", ["add", "."], { cwd: repository });
  await run(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Scripts"],
    { cwd: repository },
  );
  return repository;
}

/** Saves the Project's test targets as the user does on the Project page. */
async function putTargets(project: Project, targets: readonly unknown[]): Promise<void> {
  const response = await chat.api("PUT", `/projects/${project.id}/test-targets`, { targets });
  expect(response.status).toBe(200);
}

async function targetsOf(project: Project): Promise<TestTarget[]> {
  return testTargetListSchema.parse(await chat.read(`/projects/${project.id}/test-targets`))
    .targets;
}

/** "Run Review only when Tests changed files or ended Failed, otherwise Publish", out of Tests. */
const REVIEW_WHEN_TESTS_CHANGED_OR_FAILED = [
  {
    to: "review",
    condition: {
      combine: "any" as const,
      tests: [
        { kind: "stage" as const, stage: null, is: "changed" as const },
        { kind: "stage" as const, stage: null, is: "failed" as const },
      ],
    },
  },
  { to: "publish", condition: null },
];

/** A Review Stage after Tests. */
const REVIEW: Stage = {
  kind: "agent",
  key: "review",
  name: "Review",
  role: "developer",
  brief: "Review the change.",
  session: "fresh",
  budget: 100_000,
  optional: false,
};

/** A Project Pipeline of the Project, copied from `base`, with Lint before its last Stage. */
async function aProjectPipeline(project: Project, base: Pipeline): Promise<ProjectPipeline> {
  const copied = await chat.api("POST", "/project-pipelines", {
    projectId: project.id,
    copyOf: base.id,
    name: `${base.name} with lint`,
    description: "Then lint.",
  });
  expect(copied.status).toBe(201);
  const { id, name, description } = projectPipelineSchema.parse(await copied.json());
  const saved = await chat.api("PUT", `/project-pipelines/${id}`, {
    name,
    description,
    stages: withLint(base.stages),
  });
  expect(saved.status).toBe(200);
  return projectPipelineSchema.parse(await saved.json());
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
async function aProject(onRepository?: string): Promise<Project> {
  const repository = onRepository ?? (await aRepository());
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

/**
 * The Stages of the main line, with a Lint Stage before the last, as a plain list. The conflict
 * chain, on its own row under its Publish, is left out: a plain list is a straight line, where its
 * Stages would run every time.
 */
function withLint(stages: readonly Stage[]): Stage[] {
  const lint: Stage = {
    kind: "script",
    key: "lint",
    name: "Lint",
    optional: false,
    command: "lint",
  };
  // Without the conflict chain, which the library draws in again for a kept Publish alone.
  const plain = asPlainList(stages.filter(({ key }) => !key.startsWith("office:resolve")));
  return [...plain.slice(0, -1), lint, ...plain.slice(-1)];
}

/**
 * The Stages without their routes and positions, as a Proposal sending a plain list gives them: the
 * library converts them to a straight line, where Stages read back with routes would keep routes
 * to Stages the Proposal moved or took away.
 */
function asPlainList(stages: readonly Stage[]): Stage[] {
  return stages.map(({ routes: _routes, place: _place, position: _position, ...stage }) => stage);
}

/** The Stages with each Agent Stage keeping only the Project's test command. */
function narrowedToTest(stages: readonly Stage[]): Stage[] {
  return stages.map((stage) =>
    stage.kind === "agent"
      ? { ...stage, permissions: { ...stage.permissions, commands: ["test"] } }
      : stage,
  );
}
