import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectMcpServerValuesListSchema,
  projectMcpServerValuesSchema,
  projectSkillListSchema,
  PROJECT_LIMIT_MAX,
  projectRefusalSchema,
  projectSchema,
  taskChangesSchema,
  type NewProject,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { OfficeKnownHosts } from "../../../../platform/git-identity/office-known-hosts.js";
import { FIRST_CLAUDE_CODE_ENGINE, SkillCalled } from "../../../engine/index.js";
import { McpServerLibrary } from "../../../mcp-servers/index.js";
import { SessionSkills } from "../../../skills/index.js";
import {
  EngineLevelsChecks,
  type EngineLevelsSave,
} from "../../application/engine-levels-checks.js";
import { ProjectLevelMoves } from "../../application/project-level-moves.js";
import { ProjectDefaultChanged } from "../../domain/project-events.js";
import { ProjectRepository } from "../../ports/project-repository.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeAll(async () => {
  repository = await createTemporaryRepository();
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startProjectsApplication(repository));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

const { aNewProject, send, addProject, remoteNeedsOf, webEvents } = projectsHttp(() => ({
  app,
  url,
  published,
  repository,
}));

describe("POST /api/projects", () => {
  it("adds a Project with every command left blank, each saved as not set", async () => {
    const project = await addProject({
      installCommand: "",
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: " ", rerunCommandLine: "" },
        { key: "lint", name: "Lint", kind: "lint", commandLine: "", rerunCommandLine: "" },
        { key: "test", name: "Test", kind: "test", commandLine: "", rerunCommandLine: "" },
      ],
    });

    expect(project.installCommand).toBe("");
    expect(project.commands.map(({ commandLine }) => commandLine)).toEqual(["", "", ""]);
  });

  it("keeps the repository's folder without a trailing separator", async () => {
    const project = await addProject({ path: `${repository.path}/src/../` });

    expect(project.path).toBe(repository.path);
  });

  it.each<[string, Partial<NewProject>, string]>([
    [
      "a base branch that doesn't exist",
      { baseBranch: "develop" },
      'The repository has no branch "develop".',
    ],
    [
      "a default Pipeline that doesn't exist",
      { defaultPipeline: "nightly" },
      'There is no Pipeline "nightly".',
    ],
  ])("refuses %s with the reason, saving nothing", async (_what, fields, reason) => {
    const response = await send("POST", "/projects", aNewProject(fields));

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json())).toEqual({
      statusCode: 422,
      message: reason,
      reasons: [reason],
    });
    expect(published).toEqual([]);
  });

  it("answers 400 to a body that breaks the contract", async () => {
    const response = await send("POST", "/projects", { ...aNewProject(), publishingMode: "fax" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("publishingMode"),
    });
  });
});

describe("GET /api/projects", () => {
  it("says which part of the Office identity the base branch's remote needs", async () => {
    const tracking = (branch: string, remoteUrl: string): void => {
      gitIn(repository.path, "remote", "add", branch, remoteUrl);
      gitIn(repository.path, "branch", "--quiet", "--force", branch, "main");
      gitIn(repository.path, "config", `branch.${branch}.remote`, branch);
      gitIn(repository.path, "config", `branch.${branch}.merge`, "refs/heads/main");
    };
    tracking("on-github", "https://github.com/octo/repo.git");
    tracking("on-ssh", "git@git.example:octo/repo.git");
    gitIn(repository.path, "branch", "--quiet", "--force", "untracked", "main");

    try {
      const onGitHub = await addProject({ baseBranch: "on-github" });
      const onSsh = await addProject({ baseBranch: "on-ssh" });
      const untracked = await addProject({ baseBranch: "untracked" });
      const knownHosts = app.get(OfficeKnownHosts);
      expect(await knownHosts.unconfirmed()).toEqual([]);

      expect(await remoteNeedsOf(onGitHub)).toEqual({
        kind: "github-https",
        missing: ["sign-in-with-github"],
      });
      expect(await remoteNeedsOf(onSsh)).toEqual({
        kind: "ssh",
        host: "git.example",
        port: 22,
        missing: ["office-ssh-key", "host-key"],
      });
      expect(await knownHosts.unconfirmed()).toEqual([{ host: "git.example", port: 22 }]);
      expect(await remoteNeedsOf(untracked)).toBeNull();
    } finally {
      gitIn(repository.path, "remote", "remove", "on-github");
      gitIn(repository.path, "remote", "remove", "on-ssh");
    }
  });
});

describe("the Project's commands", () => {
  it("announces nothing when the command already has that name, kind and line", async () => {
    const project = await addProject();
    published = [];
    const { key, ...lint } = project.commands.find((command) => command.key === "lint")!;

    const response = await send("PUT", `/projects/${project.id}/commands/${key}`, lint);

    expect(response.status).toBe(200);
    expect(published).toEqual([]);
  });

  it("sets a command the Project was added without", async () => {
    const project = await addProject({
      installCommand: "",
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: "", rerunCommandLine: "" },
        { key: "lint", name: "Lint", kind: "lint", commandLine: "", rerunCommandLine: "" },
        { key: "test", name: "Test", kind: "test", commandLine: "", rerunCommandLine: "" },
      ],
    });

    const response = await send("PUT", `/projects/${project.id}/commands/test`, {
      name: "Test",
      kind: "test",
      commandLine: "npm test",
    });
    const install = await send("PUT", `/projects/${project.id}/install-command`, {
      commandLine: "npm ci",
    });

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).commands[2]?.commandLine).toBe("npm test");
    expect(projectSchema.parse(await install.json()).installCommand).toBe("npm ci");
  });

  it("refuses an empty command, a key it has no command by, and a kind there isn't", async () => {
    const project = await addProject();

    const empty = await send("PUT", `/projects/${project.id}/commands/build`, {
      name: "Build",
      kind: "build",
      commandLine: " ",
    });
    const unknown = await send("PUT", `/projects/${project.id}/commands/deploy`, {
      name: "Deploy",
      kind: "build",
      commandLine: "npm run deploy",
    });
    const wrongKind = await send("PUT", `/projects/${project.id}/commands/build`, {
      name: "Build",
      kind: "deploy",
      commandLine: "npm run build",
    });
    const clearedInstall = await send("PUT", `/projects/${project.id}/install-command`, {
      commandLine: "",
    });

    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ reasons: ["The build command can't be empty."] });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({
      reasons: ['The Project has no command with the key "deploy".'],
    });
    expect(wrongKind.status).toBe(400);
    expect(clearedInstall.status).toBe(422);
    expect(await clearedInstall.json()).toMatchObject({
      reasons: ["The install command can't be empty."],
    });
  });

  it("refuses to add a command whose key is invalid, taken or kept, or whose line is blank", async () => {
    const project = await addProject();
    const add = (command: object) => send("POST", `/projects/${project.id}/commands`, command);
    const command = { name: "More", kind: "test", commandLine: "npm run more" };

    const refused = await Promise.all([
      add({ ...command, key: "More tests" }),
      add({ ...command, key: "lint" }),
      add({ ...command, key: "install" }),
      add({ ...command, key: "more", commandLine: "" }),
    ]);

    expect(refused.map(({ status }) => status)).toEqual([422, 422, 422, 422]);
    const reasons = await Promise.all(
      refused.map(async (response) => projectRefusalSchema.parse(await response.json()).reasons),
    );
    expect(reasons).toEqual([
      [
        'A command\'s key is lower-case letters, digits and "-", starting with a letter; "More tests" is not.',
      ],
      ['The Project already has a command with the key "lint".'],
      ['The key "install" is kept for The Office\'s own use.'],
      ["The more command can't be empty."],
    ]);
  });

  it("refuses to remove a command the Project has none by", async () => {
    const project = await addProject();

    const response = await send("DELETE", `/projects/${project.id}/commands/deploy`);

    expect(response.status).toBe(422);
  });

  it("refuses to remove a command the Project's default Pipeline runs, naming the Pipeline", async () => {
    const project = await addProject();

    const response = await send("DELETE", `/projects/${project.id}/commands/test`);

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Full, this Project's default Pipeline, runs test; choose another default first.",
    ]);
  });
});

describe("PUT /api/projects/:id/install-inputs", () => {
  it("changes the install inputs and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/install-inputs`, {
      installInputs: ["package-lock.json", " apps/web/package.json "],
    });

    expect(projectSchema.parse(await response.json()).installInputs).toEqual([
      "package-lock.json",
      "apps/web/package.json",
    ]);
    expect(webEvents()).toEqual([
      { type: "project.install-inputs-changed", projectId: project.id },
    ]);
  });

  it("refuses a path outside the repository", async () => {
    const project = await addProject();

    const response = await send("PUT", `/projects/${project.id}/install-inputs`, {
      installInputs: ["../package-lock.json"],
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reasons: ['An install input is a path inside the repository; "../package-lock.json" is not.'],
    });
  });
});

describe("PUT /api/projects/:id/mark", () => {
  it("changes the label and colour together and announces it", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/mark`, {
      mark: { label: " FW ", colour: "ink" },
    });

    expect(projectSchema.parse(await response.json()).mark).toEqual({
      label: "FW",
      colour: "ink",
    });
    expect(webEvents()).toEqual([{ type: "project.mark-changed", projectId: project.id }]);
    const read = await fetch(`${url}/api/projects/${project.id}`);
    expect(projectSchema.parse(await read.json()).mark).toEqual({ label: "FW", colour: "ink" });
  });

  it("sends no event for the mark the Project already has", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/mark`, { mark: project.mark });

    expect(response.status).toBe(200);
    expect(webEvents()).toEqual([]);
  });

  it("refuses a label that isn't 1 to 3 letters or digits, as adding a Project does", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/mark`, {
      mark: { label: "A-", colour: "teal" },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reasons: ["The mark's label is 1 to 3 letters or digits."],
    });
    expect(webEvents()).toEqual([]);
  });

  it("saves a custom colour and announces it, once", async () => {
    const project = await addProject();
    published = [];
    const mark = { label: "AP", colour: "#3366cc" };

    await send("PUT", `/projects/${project.id}/mark`, { mark });
    await send("PUT", `/projects/${project.id}/mark`, { mark });

    expect(webEvents()).toEqual([{ type: "project.mark-changed", projectId: project.id }]);
    const read = await fetch(`${url}/api/projects/${project.id}`);
    expect(projectSchema.parse(await read.json()).mark).toEqual(mark);
  });

  it.each(["pink", "#12", "#ABCDEF"])("refuses %j, which isn't a colour", async (colour) => {
    const project = await addProject();

    const response = await send("PUT", `/projects/${project.id}/mark`, {
      mark: { label: "AP", colour },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("colour") });
  });

  it("says when the Project doesn't exist", async () => {
    const response = await send("PUT", "/projects/nowhere/mark", {
      mark: { label: "AP", colour: "teal" },
    });

    expect(response.status).toBe(404);
  });
});

describe("PUT /api/projects/:id/publishing-mode and /default-pipeline", () => {
  it("changes how the Project publishes and the Pipeline new Tasks start from", async () => {
    const project = await addProject();
    published = [];

    await send("PUT", `/projects/${project.id}/publishing-mode`, { publishingMode: "merge" });
    const response = await send("PUT", `/projects/${project.id}/default-pipeline`, {
      defaultPipeline: "quick-fix",
    });

    expect(projectSchema.parse(await response.json())).toMatchObject({
      publishingMode: "merge",
      defaultPipeline: "quick-fix",
    });
    expect(webEvents()).toEqual([
      { type: "project.publishing-mode-changed", projectId: project.id },
      { type: "project.default-pipeline-changed", projectId: project.id },
    ]);
  });

  it("refuses a default Pipeline that doesn't exist", async () => {
    const project = await addProject();

    const response = await send("PUT", `/projects/${project.id}/default-pipeline`, {
      defaultPipeline: "nightly",
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reasons: ['There is no Pipeline "nightly".'] });
  });
});

describe("PUT /api/projects/:id/project-limit", () => {
  it("sends no event for the limit the Project already has", async () => {
    const project = await addProject();
    published = [];

    await send("PUT", `/projects/${project.id}/project-limit`, { projectLimit: 1 });

    expect(published).toEqual([]);
  });

  it.each([0, PROJECT_LIMIT_MAX + 1, 1.5])("refuses %s with the reason", async (projectLimit) => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/project-limit`, { projectLimit });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("projectLimit"),
    });
    expect(published).toEqual([]);
  });

  it("says when the Project doesn't exist", async () => {
    const response = await send("PUT", "/projects/no-such-project/project-limit", {
      projectLimit: 2,
    });

    expect(response.status).toBe(404);
  });
});

// `claude-code` is listed in the database every test file shares, so no test removes it or lists its own.
const SONNET = { engineId: "claude-code", model: "claude-sonnet-5-5" };
const HAIKU = { engineId: "claude-code", model: "claude-haiku-5-5" };

describe("the Project's engine levels", () => {
  it("keeps the Project default, its use for every Role and the Role overrides", async () => {
    const project = await addProject();
    expect(project).toMatchObject({
      projectDefault: null,
      useForEveryRole: false,
      roleOverrides: [],
    });
    published = [];

    await send("PUT", `/projects/${project.id}/project-default`, { projectDefault: SONNET });
    await send("PUT", `/projects/${project.id}/use-for-every-role`, { useForEveryRole: true });
    await send("PUT", `/projects/${project.id}/role-overrides/cto`, { roleOverride: HAIKU });
    await send("PUT", `/projects/${project.id}/role-overrides/reviewer`, { roleOverride: SONNET });
    const response = await send("PUT", `/projects/${project.id}/role-overrides/reviewer`, {
      roleOverride: null,
    });

    expect(response.status).toBe(200);
    const expected = {
      projectDefault: SONNET,
      useForEveryRole: true,
      roleOverrides: [{ roleKey: "cto", ...HAIKU }],
    };
    expect(projectSchema.parse(await response.json())).toMatchObject(expected);
    const read = await fetch(`${url}/api/projects/${project.id}`);
    expect(projectSchema.parse(await read.json())).toMatchObject(expected);
    expect(webEvents()).toEqual([
      { type: "project.project-default-changed", projectId: project.id },
      { type: "project.use-for-every-role-changed", projectId: project.id },
      { type: "project.role-override-changed", projectId: project.id },
      { type: "project.role-override-changed", projectId: project.id },
      { type: "project.role-override-changed", projectId: project.id },
    ]);
  });

  it("moves the levels naming a removed engine to the replacement, each with its event", async () => {
    const project = await addProject();
    // An engine of this test's own, set past the checks, so other test files' Projects stay.
    const removed = `removed-${randomUUID()}`;
    const projectDefault = { engineId: removed, model: "claude-sonnet-5-5" };
    await app.get(ProjectRepository).update(project.id, (stored) => ({
      project: {
        ...stored,
        projectDefault,
        roleOverrides: [
          { roleKey: "cto", engineId: removed, model: "gpt-oss" },
          { roleKey: "reviewer", ...SONNET },
        ],
      },
      // The repository keeps a change that has an event.
      events: [new ProjectDefaultChanged(stored.id, projectDefault)],
    }));
    published = [];
    const second = { ...FIRST_CLAUDE_CODE_ENGINE, id: "second", defaultModel: "claude-haiku-5-5" };

    await app.get(ProjectLevelMoves).moveProjectLevels({ engineId: removed, replacement: second });

    const read = await fetch(`${url}/api/projects/${project.id}`);
    expect(projectSchema.parse(await read.json())).toMatchObject({
      projectDefault: { engineId: "second", model: "claude-sonnet-5-5" },
      roleOverrides: [
        // The replacement doesn't offer the model, so the override takes its default model.
        { roleKey: "cto", engineId: "second", model: "claude-haiku-5-5" },
        { roleKey: "reviewer", ...SONNET },
      ],
    });
    expect(webEvents()).toEqual([
      { type: "project.project-default-changed", projectId: project.id },
      { type: "project.role-override-changed", projectId: project.id },
    ]);
  });

  it("moves the levels naming the only engine, removed, to none, the force going with the default", async () => {
    const project = await addProject();
    const removed = `removed-${randomUUID()}`;
    const projectDefault = { engineId: removed, model: "claude-sonnet-5-5" };
    await app.get(ProjectRepository).update(project.id, (stored) => ({
      project: {
        ...stored,
        projectDefault,
        useForEveryRole: true,
        roleOverrides: [{ roleKey: "cto", engineId: removed, model: "gpt-oss" }],
      },
      events: [new ProjectDefaultChanged(stored.id, projectDefault)],
    }));
    published = [];

    await app.get(ProjectLevelMoves).moveProjectLevels({ engineId: removed, replacement: null });

    const read = await fetch(`${url}/api/projects/${project.id}`);
    expect(projectSchema.parse(await read.json())).toMatchObject({
      projectDefault: null,
      useForEveryRole: false,
      roleOverrides: [],
    });
    expect(webEvents()).toEqual([
      { type: "project.use-for-every-role-changed", projectId: project.id },
      { type: "project.project-default-changed", projectId: project.id },
      { type: "project.role-override-changed", projectId: project.id },
    ]);
  });

  it("refuses an engine that isn't listed, a model it doesn't offer, and a force without a default", async () => {
    const project = await addProject();

    const responses = await Promise.all([
      send("PUT", `/projects/${project.id}/project-default`, {
        projectDefault: { engineId: "gone", model: "claude-sonnet-5-5" },
      }),
      send("PUT", `/projects/${project.id}/role-overrides/cto`, {
        roleOverride: { engineId: "claude-code", model: "gpt-oss" },
      }),
      send("PUT", `/projects/${project.id}/use-for-every-role`, { useForEveryRole: true }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([422, 422, 422]);
    expect(await Promise.all(responses.map((response) => response.json()))).toMatchObject([
      { reasons: ['There is no engine "gone".'] },
      { reasons: ["Choose a model the engine offers."] },
      { reasons: ["Choose a Project default before using it for every Role."] },
    ]);
  });
  it("refuses a save a registered check refuses, before keeping it", async () => {
    const project = await addProject();
    const saves: EngineLevelsSave[] = [];
    app.get(EngineLevelsChecks).register(async (save) => {
      saves.push(save);
      return save.after.projectDefault
        ? ["In this Project, the Developer would run on Local models."]
        : [];
    });
    published = [];

    const response = await send("PUT", `/projects/${project.id}/project-default`, {
      projectDefault: SONNET,
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reasons: ["In this Project, the Developer would run on Local models."],
    });
    const levels = { projectDefault: null, useForEveryRole: false, roleOverrides: [] };
    expect(saves).toEqual([
      {
        projectId: project.id,
        projectName: project.name,
        before: levels,
        after: { ...levels, projectDefault: SONNET },
      },
    ]);
    const read = await fetch(`${url}/api/projects/${project.id}`);
    expect(projectSchema.parse(await read.json())).toMatchObject({ projectDefault: null });
    expect(published).toEqual([]);
  });
});

describe("the repository's own skills", () => {
  it("lists them from the repository, read-only, and switches their use", async () => {
    const skillFolder = join(repository.path, ".claude", "skills", "deploy");
    await mkdir(skillFolder, { recursive: true });
    await writeFile(
      join(skillFolder, "SKILL.md"),
      "---\nname: deploy\ndescription: Deploys the panel.\n---\nDeploy it.\n",
    );
    try {
      const project = await addProject();
      published = [];

      const listed = await fetch(`${url}/api/projects/${project.id}/skills`);
      const switched = await send("PUT", `/projects/${project.id}/use-project-skills`, {
        useProjectSkills: false,
      });

      expect(projectSkillListSchema.parse(await listed.json())).toEqual([
        {
          key: "deploy",
          name: "deploy",
          description: "Deploys the panel.",
          path: ".claude/skills/deploy",
          listedAtStart: true,
          alsoInLibrary: false,
          usesInLast7Days: 0,
        },
      ]);
      expect(projectSchema.parse(await switched.json()).useProjectSkills).toBe(false);
      expect(webEvents()).toEqual([
        { type: "project.use-project-skills-changed", projectId: project.id },
      ]);
    } finally {
      await rm(join(repository.path, ".claude"), { recursive: true, force: true });
    }
  });

  it("gives each its uses in the Project in the last 7 days, two of one key alike", async () => {
    const skillMd = "---\nname: deploy\ndescription: Deploys.\n---\nDeploy it.\n";
    for (const folder of [repository.path, join(repository.path, "apps", "web")]) {
      await mkdir(join(folder, ".claude", "skills", "deploy"), { recursive: true });
      await writeFile(join(folder, ".claude", "skills", "deploy", "SKILL.md"), skillMd);
    }
    try {
      const project = await addProject();
      const sessionId = randomUUID();
      await app.get(SessionSkills).prepare({
        sessionId,
        roleKey: "developer",
        project: {
          id: project.id,
          folder: repository.path,
          useProjectSkills: true,
          projectSkillsOff: [],
        },
      });
      await app
        .get(EventBus)
        .publish(new SkillCalled(sessionId, "claude-code", "deploy", new Date()));
      await app.get(SessionSkills).forget(sessionId);

      const listed = await fetch(`${url}/api/projects/${project.id}/skills`);

      expect(
        projectSkillListSchema.parse(await listed.json()).map(({ path, usesInLast7Days }) => ({
          path,
          usesInLast7Days,
        })),
      ).toEqual([
        { path: ".claude/skills/deploy", usesInLast7Days: 1 },
        { path: "apps/web/.claude/skills/deploy", usesInLast7Days: 1 },
      ]);
    } finally {
      await rm(join(repository.path, ".claude"), { recursive: true, force: true });
      await rm(join(repository.path, "apps"), { recursive: true, force: true });
    }
  });

  it("turns one of the repository's skills off and on by its key", async () => {
    const project = await addProject();
    published = [];

    const off = await send("PUT", `/projects/${project.id}/skill-use`, {
      key: "deploy",
      use: false,
    });
    const offProject = projectSchema.parse(await off.json());
    const on = await send("PUT", `/projects/${project.id}/skill-use`, {
      key: "deploy",
      use: true,
    });

    expect(offProject.projectSkillsOff).toEqual(["deploy"]);
    expect(projectSchema.parse(await on.json()).projectSkillsOff).toEqual([]);
    expect(webEvents()).toEqual([
      { type: "project.skill-use-changed", projectId: project.id },
      { type: "project.skill-use-changed", projectId: project.id },
    ]);
  });

  it("refuses a change with no key", async () => {
    const project = await addProject();

    const refused = await send("PUT", `/projects/${project.id}/skill-use`, { key: "", use: false });

    expect(refused.status).toBe(400);
  });
});

describe("GET /api/projects/:id/tasks/:taskId/changes", () => {
  it("answers the Task branch's committed files with their lines and the diff", async () => {
    const project = await addProject();
    const taskId = randomUUID();
    const worktreePath = join(repository.folder, "task-changes", taskId);
    gitIn(repository.path, "worktree", "add", "--quiet", "-b", `office/${taskId}`, worktreePath);
    await writeFile(join(worktreePath, "work.txt"), "a Stage's work\n");
    gitIn(worktreePath, "add", ".");
    gitIn(worktreePath, "commit", "--quiet", "--message", "Implement: a Stage's work");

    const response = await fetch(`${url}/api/projects/${project.id}/tasks/${taskId}/changes`);

    expect(response.status).toBe(200);
    const changes = taskChangesSchema.parse(await response.json());
    expect(changes.files).toEqual([
      { path: "work.txt", previousPath: null, lines: { added: 1, removed: 0 }, deleted: false },
    ]);
    expect(changes.diff).toContain("+a Stage's work\n");
    expect(changes.diffCut).toBe(false);
  });

  it("answers no changes for a Task without a branch yet", async () => {
    const project = await addProject();

    const response = await fetch(`${url}/api/projects/${project.id}/tasks/${randomUUID()}/changes`);

    expect(await response.json()).toEqual({
      worktreePath: null,
      files: [],
      diff: "",
      diffCut: false,
    });
  });

  it("answers 404 for a Project that doesn't exist and 400 for a Task id that isn't one", async () => {
    const project = await addProject();

    const missing = await fetch(`${url}/api/projects/nowhere/tasks/${randomUUID()}/changes`);
    const malformed = await fetch(`${url}/api/projects/${project.id}/tasks/not-a-task/changes`);

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});

const PROJECT_SECRET = "project-secret-never-sent-back";

async function addMcpServer(): Promise<string> {
  const name = `github-${randomUUID().slice(0, 8)}`;
  await app.get(McpServerLibrary).add({
    name,
    connection: { transport: "stdio", command: "npx", arguments: ["server-github"] },
    serverValues: [
      { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValue: "office-secret" },
      { name: "GITHUB_HOST", secret: false, required: false, officeWideValue: "github.com" },
    ],
  });
  return name;
}

describe("Server values", () => {
  it("keeps a Project's values over the Office-wide ones, a secret's never sent back", async () => {
    const project = await addProject();
    const serverName = await addMcpServer();

    const changed = await send("PUT", `/projects/${project.id}/server-values/${serverName}`, {
      serverValues: [
        { name: "GITHUB_TOKEN", projectValue: PROJECT_SECRET },
        { name: "GITHUB_HOST", projectValue: "github.example.com" },
      ],
    });
    expect(changed.status).toBe(200);
    expect(await changed.clone().text()).not.toContain(PROJECT_SECRET);
    const listed = await fetch(`${url}/api/projects/${project.id}/server-values`);
    const text = await listed.text();

    expect(text).not.toContain(PROJECT_SECRET);
    expect(text).not.toContain("office-secret");
    const values = projectMcpServerValuesListSchema
      .parse(JSON.parse(text))
      .find((server) => server.serverName === serverName);
    expect(values).toEqual(projectMcpServerValuesSchema.parse(await changed.json()));
    expect(values?.serverValues).toEqual([
      {
        name: "GITHUB_TOKEN",
        secret: true,
        required: true,
        officeWideValueSet: true,
        projectValueSet: true,
      },
      {
        name: "GITHUB_HOST",
        secret: false,
        required: false,
        officeWideValue: "github.com",
        officeWideValueSet: true,
        projectValue: "github.example.com",
        projectValueSet: true,
      },
    ]);
  });

  it("keeps a value given none and clears one given empty", async () => {
    const project = await addProject();
    const serverName = await addMcpServer();
    const path = `/projects/${project.id}/server-values/${serverName}`;
    await send("PUT", path, {
      serverValues: [
        { name: "GITHUB_TOKEN", projectValue: PROJECT_SECRET },
        { name: "GITHUB_HOST", projectValue: "github.example.com" },
      ],
    });

    const changed = projectMcpServerValuesSchema.parse(
      await (
        await send("PUT", path, {
          serverValues: [{ name: "GITHUB_TOKEN" }, { name: "GITHUB_HOST", projectValue: "" }],
        })
      ).json(),
    );

    expect(changed.serverValues.map(({ projectValueSet }) => projectValueSet)).toEqual([
      true,
      false,
    ]);
  });

  it("refuses a name that isn't one of the server's values, or a server the library hasn't", async () => {
    const project = await addProject();
    const serverName = await addMcpServer();

    const unknownValue = await send("PUT", `/projects/${project.id}/server-values/${serverName}`, {
      serverValues: [{ name: "TOKEN", projectValue: "x" }],
    });
    const unknownServer = await send("PUT", `/projects/${project.id}/server-values/nothing`, {
      serverValues: [],
    });
    const unknownProject = await fetch(`${url}/api/projects/${randomUUID()}/server-values`);

    expect(unknownValue.status).toBe(422);
    expect(projectRefusalSchema.parse(await unknownValue.json()).reasons).toEqual([
      `"TOKEN" is not a Server value of "${serverName}".`,
    ]);
    expect(unknownServer.status).toBe(422);
    expect(unknownProject.status).toBe(404);
  });
});
