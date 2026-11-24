import { describe, expect, it } from "vitest";
import type { Action } from "../domain/action.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { InMemoryActionRepository } from "../ports/action-repository.fixtures.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { ActionRunSettings } from "./action-run-settings.js";

class OneProject extends ProjectRepository {
  constructor(private readonly project: Project) {
    super();
  }

  find(id: string): Promise<Project | undefined> {
    return Promise.resolve(id === this.project.id ? this.project : undefined);
  }

  add = notUsed;
  list = notUsed;
  update = notUsed;
}

function notUsed(): never {
  throw new Error("Not used by an Action run's settings.");
}

const SECRET = "s3cret-deploy-token";

function settingsOver(project: Project, actions: readonly Action[]): ActionRunSettings {
  const repository = new InMemoryActionRepository();
  repository.keep(project.id, actions);
  return new ActionRunSettings(new OneProject(project), repository);
}

const BUILD_WEB: Action = {
  key: "build-web",
  name: "Build web",
  kind: "project-command",
  settings: { commandKey: "build", commandsBefore: ["install", "lint"], timeLimitMinutes: null },
  leavesTheWorkstation: false,
  setBy: {},
};

describe("ActionRunSettings", () => {
  const project = aProject({
    runEnvironment: "on",
    environment: {
      set: [
        { name: "REGISTRY", value: "https://registry.example.test", secret: false },
        { name: "DEPLOY_TOKEN", value: SECRET, secret: true },
      ],
      unset: ["NODE_OPTIONS"],
      prependPath: [],
    },
  });

  it("answers the Project as a run reads it, the Actions switch among it", async () => {
    const settings = settingsOver(project, [BUILD_WEB]);

    await expect(settings.projectOf(project.id)).resolves.toEqual({
      id: project.id,
      name: project.name,
      baseBranch: "main",
      runEnvironmentOn: true,
      actionsOn: true,
    });
    await expect(
      settingsOver({ ...project, features: { actions: false } }, []).projectOf(project.id),
    ).resolves.toMatchObject({ actionsOn: false });
    await expect(settings.actionOf(project.id, "build-web")).resolves.toEqual(BUILD_WEB);
    await expect(settings.actionOf(project.id, "gone")).resolves.toBeUndefined();
    await expect(settings.actionsOf(project.id)).resolves.toEqual([BUILD_WEB]);
  });

  it("resolves a Project command Action's commands, Install among them, with its time, environment and mask", async () => {
    const run = await settingsOver(project, [BUILD_WEB]).commandRunOf(project.id, "build-web");

    expect(run.commands).toEqual([
      { name: "Install", commandLine: "npm ci" },
      { name: "Lint", commandLine: "npm run lint" },
      { name: "Build", commandLine: "npm run build" },
    ]);
    expect(run.missingCommands).toEqual([]);
    expect(run.timeoutMs).toBe(60 * 60_000);
    expect(run.environment).toEqual(project.environment);
    expect(run.mask.mask(`token ${SECRET}`)).toBe("token [secret DEPLOY_TOKEN]");
    expect(run.install).toEqual({
      installCommand: "npm ci",
      installInputs: project.installInputs,
      installVariables: project.environment.set,
    });
  });

  it("names the commands the Project no longer has, and takes the Action's own time limit", async () => {
    const run = await settingsOver(project, [
      {
        ...BUILD_WEB,
        settings: { commandKey: "deploy", commandsBefore: ["install", "e2e"], timeLimitMinutes: 5 },
      },
    ]).commandRunOf(project.id, "build-web");

    expect(run.commands).toEqual([{ name: "Install", commandLine: "npm ci" }]);
    expect(run.missingCommands).toEqual(["e2e", "deploy"]);
    expect(run.timeoutMs).toBe(5 * 60_000);
  });

  it("refuses a key the Project has no Action of, and an Action of another kind", async () => {
    const settings = settingsOver(project, [
      {
        key: "release",
        name: "Release",
        kind: "workflow",
        settings: { file: "release.yml", inputs: {} },
        leavesTheWorkstation: true,
        setBy: {},
      },
    ]);

    await expect(settings.commandRunOf(project.id, "gone")).rejects.toBeInstanceOf(ProjectRefused);
    await expect(settings.commandRunOf(project.id, "release")).rejects.toMatchObject({
      reasons: ["The Action Release doesn't run a Project command."],
    });
  });
});
