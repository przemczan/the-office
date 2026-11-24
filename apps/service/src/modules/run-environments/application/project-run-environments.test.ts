import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { PullRequestMerged, type SettingChangedBy } from "../../projects/index.js";
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
  runEnvironment: RunEnvironmentSetting = "not-decided";
  readonly landed: string[] = [];
  readonly finished: (readonly string[])[] = [];

  async settingOf(): Promise<ProjectSetting> {
    return { runEnvironment: this.runEnvironment, setUpProblems: [] };
  }

  async change(
    _projectId: string,
    runEnvironment: Exclude<RunEnvironmentSetting, "not-decided">,
    _problems: readonly string[],
    _by: SettingChangedBy,
  ): Promise<void> {
    this.runEnvironment = runEnvironment;
  }

  async finishSetUp(_projectId: string, problems: readonly string[]): Promise<void> {
    this.finished.push(problems);
    if (problems.length === 0) this.runEnvironment = "on";
  }

  async landDefinition(projectId: string): Promise<void> {
    this.landed.push(projectId);
    if (this.runEnvironment === "not-decided") this.runEnvironment = "on";
  }
}

/**
 * The repository: the base branch fetched now, and each Task's branch tip and where it forked from
 * the base, by commit.
 */
class Repository extends RepositoryFiles {
  readonly commits = new Map<string, Files>();
  base = "base";
  readonly tips = new Map<string, string>();
  readonly forkPoints = new Map<string, string>();
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

  async taskForkPoint(_projectId: string, taskId: string): Promise<string> {
    const forkPoint = this.forkPoints.get(taskId);
    if (forkPoint === undefined) throw new Error(`The Task ${taskId} has no branch.`);
    return forkPoint;
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
  readonly projects = new Map<string, string>([["task-1", "shop"]]);

  async openOf(): Promise<undefined> {
    return undefined;
  }

  add(): Promise<OffBoardTaskStart> {
    return notUsed();
  }

  async setUpTaskOf(taskId: string): Promise<SetUpTask | undefined> {
    return this.setUps.find((task) => task.id === taskId);
  }

  async projectOf(taskId: string): Promise<string | undefined> {
    return this.projects.get(taskId);
  }
}

function notUsed(): never {
  throw new Error("Not used here.");
}

let settings: Settings;
let repository: Repository;
let tasks: Tasks;
let events: EventBus;

beforeEach(() => {
  settings = new Settings();
  repository = new Repository();
  tasks = new Tasks();
  events = new EventBus();
  new ProjectRunEnvironments(settings, repository, tasks, events).onModuleInit();
});

/**
 * The base branch and the Task's branch tip holding these files, the tip's branch forked from a
 * base holding `forkedFrom`: by default none of the definition, which the Task's branch added.
 */
function committed(
  base: Files,
  tip: Files | undefined,
  { taskId = "task-1", forkedFrom = {} }: { taskId?: string; forkedFrom?: Files } = {},
): void {
  repository.commits.set("base", base);
  if (tip !== undefined) {
    repository.commits.set(`tip-${taskId}`, tip);
    repository.tips.set(taskId, `tip-${taskId}`);
    repository.commits.set(`fork-${taskId}`, forkedFrom);
    repository.forkPoints.set(taskId, `fork-${taskId}`);
  }
}

/** The landing runs in the background; with these ports, a turn of the event loop ends it. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function done(taskId = "task-1"): Promise<void> {
  await events.publish(new TaskStateChanged(taskId, "in-progress", "done"));
  await settled();
}

async function merged(taskId = "task-1"): Promise<void> {
  await events.publish(
    new PullRequestMerged(
      "pr-1",
      "shop",
      taskId,
      7,
      "https://example.com/7",
      "squash",
      {
        kind: "code-host",
        name: "GitHub",
      },
      new Date(),
    ),
  );
  await settled();
}

describe("a Task's definition landing on the base branch", () => {
  it("turns Not decided yet On when a Task is Done with its valid definition on the base branch", async () => {
    committed(VALID, VALID);

    await done();

    expect(settings.runEnvironment).toBe("on");
    expect(settings.landed).toEqual(["shop"]);
    expect(repository.fetches).toBe(1);
  });

  it("turns it On when the Task's pull request merges, its definition on the base branch then", async () => {
    // Push + PR: Done before the merge, the base without the definition yet.
    committed({}, VALID);
    await done();
    expect(settings.runEnvironment).toBe("not-decided");

    repository.commits.set("base", VALID);
    await merged();

    expect(settings.runEnvironment).toBe("on");
  });

  it("leaves it as it was after a push-only publish, the base branch without the definition", async () => {
    committed({ "README.md": "# Shop\n" }, VALID);

    await done();

    expect(settings.runEnvironment).toBe("not-decided");
    expect(settings.landed).toEqual([]);
  });

  it("leaves it as it was when the Task's branch didn't change the definition the base already had", async () => {
    // Committed on the base by hand while Not decided yet; any Task's Done lands it no more.
    committed(VALID, VALID, { forkedFrom: VALID });

    await done();
    await merged();

    expect(settings.runEnvironment).toBe("not-decided");
    expect(settings.landed).toEqual([]);
  });

  it("turns it On when the Task's branch changed a valid definition it forked with", async () => {
    const node20 = {
      ...VALID,
      ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:20\n",
    };
    committed(VALID, VALID, { forkedFrom: node20 });

    await done();

    expect(settings.runEnvironment).toBe("on");
  });

  it("leaves it as it was when the base branch's definition differs from the Task's", async () => {
    committed(
      { ...VALID, ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:20\n" },
      VALID,
    );

    await done();

    expect(settings.runEnvironment).toBe("not-decided");
  });

  it("leaves it as it was with an invalid definition", async () => {
    committed(INVALID, INVALID);

    await done();
    await merged();

    expect(settings.runEnvironment).toBe("not-decided");
    expect(settings.landed).toEqual([]);
  });

  it("leaves it as it was when the Task has no branch", async () => {
    committed(VALID, undefined);

    await done();

    expect(settings.runEnvironment).toBe("not-decided");
  });

  it("never changes an explicit Off, nor fetches for it", async () => {
    settings.runEnvironment = "off";
    committed(VALID, VALID);

    await done();
    await merged();

    expect(settings.runEnvironment).toBe("off");
    expect(settings.landed).toEqual([]);
    expect(repository.fetches).toBe(0);
  });

  it("does nothing for a Task that isn't Done, or that it can't find", async () => {
    committed(VALID, VALID);

    await events.publish(new TaskStateChanged("task-1", "in-progress", "dropped"));
    await done("task-unknown");

    expect(settings.runEnvironment).toBe("not-decided");
  });

  it("finishes a set-up Task's Done from its own branch as before, without the landing check", async () => {
    tasks.setUps.push({ id: "task-1", projectId: "shop", title: "Set up", state: "done" });
    committed({}, VALID);

    await done();

    expect(settings.finished).toEqual([[]]);
    expect(settings.runEnvironment).toBe("on");
    expect(settings.landed).toEqual([]);
    expect(repository.fetches).toBe(0);
  });

  it("logs and leaves the setting when reading the repository fails", async () => {
    committed(VALID, VALID);
    repository.freshBase = () => Promise.reject(new Error("The fetch failed."));

    await done();

    expect(settings.runEnvironment).toBe("not-decided");
  });
});
