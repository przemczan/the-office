import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SettingChangedBy } from "../../projects/index.js";
import { TaskStateChanged, type OffBoardTaskStart } from "../../work/index.js";
import {
  ProjectSettings,
  type ProjectSetting,
  type RunEnvironmentSetting,
} from "../ports/project-settings.js";
import { RepositoryFiles } from "../ports/repository-files.js";
import { SetUpTasks, type SetUpTask } from "../ports/set-up-tasks.js";
import { ProjectRunEnvironments } from "./project-run-environments.js";

const VALID = {
  ".devcontainer/devcontainer.json": '{ "dockerComposeFile": "compose.yaml", "service": "app" }',
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

const INVALID = {
  ".devcontainer/devcontainer.json": '{ "dockerComposeFile": "compose.yaml" }',
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

type Files = Readonly<Record<string, string>>;

/** The Project's setting as Projects keeps it, and how it was changed. */
class Settings extends ProjectSettings {
  runEnvironment: RunEnvironmentSetting = "off";
  readonly finished: (readonly string[])[] = [];

  async settingOf(): Promise<ProjectSetting> {
    return { runEnvironment: this.runEnvironment, setUpProblems: [] };
  }

  async change(
    _projectId: string,
    runEnvironment: RunEnvironmentSetting,
    _by: SettingChangedBy,
  ): Promise<void> {
    this.runEnvironment = runEnvironment;
  }

  async finishSetUp(_projectId: string, problems: readonly string[]): Promise<void> {
    this.finished.push(problems);
    if (problems.length === 0) this.runEnvironment = "on";
  }
}

/** The repository: the base branch fetched now, and each Task's branch tip, by commit. */
class Repository extends RepositoryFiles {
  readonly commits = new Map<string, Files>();
  base = "base";
  readonly tips = new Map<string, string>();
  fetches = 0;

  async lastFetchedBase(): Promise<string> {
    return this.base;
  }

  async freshBase(): Promise<string> {
    this.fetches += 1;
    return this.base;
  }

  async taskBranchTip(_projectId: string, taskId: string): Promise<string | undefined> {
    return this.tips.get(taskId);
  }

  async textAt(_projectId: string, commit: string, path: string): Promise<string | undefined> {
    return this.commits.get(commit)?.[path];
  }

  uncommittedPathsUnder = notUsed;
  commitFolder = notUsed;
  restoreFolder = notUsed;
}

class Tasks extends SetUpTasks {
  readonly setUps: SetUpTask[] = [];

  async openOf(): Promise<undefined> {
    return undefined;
  }

  add(): Promise<OffBoardTaskStart> {
    return notUsed();
  }

  async setUpTaskOf(taskId: string): Promise<SetUpTask | undefined> {
    return this.setUps.find((task) => task.id === taskId);
  }
}

function notUsed(): never {
  throw new Error("Not used here.");
}

let settings: Settings;
let repository: Repository;
let tasks: Tasks;
let events: EventBus;
let runEnvironments: ProjectRunEnvironments;

const BY_ANN: SettingChangedBy = { kind: "user", user: { userId: "user-ann", name: "Ann" } };

beforeEach(() => {
  settings = new Settings();
  repository = new Repository();
  tasks = new Tasks();
  events = new EventBus();
  runEnvironments = new ProjectRunEnvironments(settings, repository, tasks, events);
  runEnvironments.onModuleInit();
});

/** The base branch and the Task's branch tip holding these files. */
function committed(base: Files, tip: Files | undefined, taskId = "task-1"): void {
  repository.commits.set("base", base);
  if (tip !== undefined) {
    repository.commits.set(`tip-${taskId}`, tip);
    repository.tips.set(taskId, `tip-${taskId}`);
  }
}

async function done(taskId = "task-1"): Promise<void> {
  await events.publish(new TaskStateChanged(taskId, "in-progress", "done"));
}

describe("the switch", () => {
  it("turns On with no definition on the base branch, nor fetches for it", async () => {
    committed({ "README.md": "# Shop\n" }, undefined);

    const after = await runEnvironments.change("shop", "on", BY_ANN);

    expect(settings.runEnvironment).toBe("on");
    expect(after.runEnvironment).toBe("on");
    expect(repository.fetches).toBe(0);
  });

  it("turns Off again at any time", async () => {
    settings.runEnvironment = "on";

    await runEnvironments.change("shop", "off", BY_ANN);

    expect(settings.runEnvironment).toBe("off");
  });
});

describe("a Task's Done", () => {
  it("turns On a set-up Task's Project from the valid definition on its own branch", async () => {
    tasks.setUps.push({ id: "task-1", projectId: "shop", title: "Set up", state: "done" });
    // Push + PR: Done before the merge, the base without the definition yet.
    committed({}, VALID);

    await done();

    expect(settings.finished).toEqual([[]]);
    expect(settings.runEnvironment).toBe("on");
    expect(repository.fetches).toBe(0);
  });

  it("leaves a set-up Task's Project as it was with an invalid definition, keeping why", async () => {
    tasks.setUps.push({ id: "task-1", projectId: "shop", title: "Set up", state: "done" });
    committed({}, INVALID);

    await done();

    expect(settings.finished).toHaveLength(1);
    expect(settings.finished[0]?.length).toBeGreaterThan(0);
    expect(settings.runEnvironment).toBe("off");
  });

  it("leaves a set-up Task's Project as it was when the Task has no branch", async () => {
    tasks.setUps.push({ id: "task-1", projectId: "shop", title: "Set up", state: "done" });
    committed({}, undefined);

    await done();

    expect(settings.finished).toEqual([
      ["The Task Set up has no branch to read .devcontainer/ from."],
    ]);
    expect(settings.runEnvironment).toBe("off");
  });

  it("changes nothing for any other Task, even one whose valid definition is on the base branch", async () => {
    committed(VALID, VALID);

    await done();

    expect(settings.runEnvironment).toBe("off");
    expect(settings.finished).toEqual([]);
    expect(repository.fetches).toBe(0);
  });

  it("does nothing for a set-up Task that isn't Done", async () => {
    tasks.setUps.push({ id: "task-1", projectId: "shop", title: "Set up", state: "dropped" });
    committed({}, VALID);

    await events.publish(new TaskStateChanged("task-1", "in-progress", "dropped"));

    expect(settings.runEnvironment).toBe("off");
  });
});
