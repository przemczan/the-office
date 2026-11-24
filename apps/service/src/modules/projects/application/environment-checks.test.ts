import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import { BusyWork } from "../../office-updates/index.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { EnvironmentCheck } from "../domain/environment-check.js";
import { EnvironmentCheckStarted } from "../domain/environment-check-events.js";
import { startingCommands } from "../domain/project.fixtures.js";
import type { Project, RunEnvironmentSetting } from "../domain/project.js";
import { EnvironmentCheckRepository } from "../ports/environment-check-repository.js";
import { worktreesOnATemporaryRepository } from "../worktrees.fixtures.js";
import { EnvironmentChecks } from "./environment-checks.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import type { ProjectService } from "./project-service.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";
import type { ScriptedTaskRunEnvironments } from "./task-run-environments.fixtures.js";

const PASSES = `node -e "process.exit(0)"`;
/** Passes only where the Task's branch's own file is. */
const ON_THE_TASKS_BRANCH = `node -e "process.exit(require('fs').existsSync('task.txt') ? 0 : 1)"`;
const SLEEPS = `node -e "setTimeout(() => {}, 60000)"`;

class KeptChecks extends EnvironmentCheckRepository {
  readonly kept = new Map<string, EnvironmentCheck>();
  save(check: EnvironmentCheck): Promise<void> {
    this.kept.set(check.projectId, check);
    return Promise.resolve();
  }
  listAll(): Promise<readonly EnvironmentCheck[]> {
    return Promise.resolve([...this.kept.values()]);
  }
  find(projectId: string): Promise<EnvironmentCheck | undefined> {
    return Promise.resolve(this.kept.get(projectId));
  }
}

// Real git and real commands on a temporary repository whose main tracks its origin's.
let repository: TemporaryRepository;
let runEnvironments: ScriptedTaskRunEnvironments;
let checks: EnvironmentChecks;
let events: EventBus;
let project: Project;
let tasksCommit: string;

const TASK = "3f0c2a8e-0d6b-4d0e-9a51-6b1f0a7c2d11";

beforeAll(async () => {
  const made = await worktreesOnATemporaryRepository();
  ({ repository, runEnvironments } = made);
  gitIn(repository.path, "checkout", "--quiet", "-b", `office/${TASK}`);
  await writeFile(join(repository.path, "task.txt"), "the Task's\n");
  gitIn(repository.path, "add", "task.txt");
  gitIn(repository.path, "commit", "--quiet", "-m", "The Task's commit");
  tasksCommit = gitIn(repository.path, "rev-parse", "HEAD");
  gitIn(repository.path, "checkout", "--quiet", "main");
  project = {
    ...made.project,
    installCommand: PASSES,
    installInputs: [],
    commands: startingCommands({ build: ON_THE_TASKS_BRANCH, lint: PASSES, test: "" }),
  };
  const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  events = new EventBus();
  checks = new EnvironmentChecks(
    { read: () => Promise.resolve(project) } as unknown as ProjectService,
    made.worktrees,
    new ProjectRemotes(git, officeIdentityForTests()),
    commands,
    taskCommandsOver(commands, git, runEnvironments.registry()),
    new KeptChecks(),
    events,
    new BusyWork(events),
  );
});

afterAll(async () => {
  await repository.remove();
});

function withSetting(runEnvironment: RunEnvironmentSetting, definitionCarried: boolean): void {
  project = { ...project, runEnvironment };
  runEnvironments.definitionCarried = definitionCarried;
}

describe("EnvironmentChecks of a Task's branch", REAL_GIT_TEST, () => {
  it("checks the head of the Task's branch on the host when the Run environment is Off", async () => {
    withSetting("off", true);
    const ran = runEnvironments.runs.length;

    const check = await checks.check(project.id, { taskId: TASK });

    expect(check).toMatchObject({ taskId: TASK, state: "passed" });
    expect(check.checks[0]).toEqual({
      step: "worktree",
      state: "passed",
      base: { commit: tasksCommit, fetchedFrom: undefined },
    });
    expect(runEnvironments.runs.length).toBe(ran);
  });

  it("runs in the Task's run environment when Not decided yet and its branch carries a definition", async () => {
    withSetting("not-decided", true);
    const ran = runEnvironments.runs.length;
    const started = runEnvironments.starts.length;

    const check = await checks.check(project.id, { taskId: TASK });

    expect(check.state).toBe("passed");
    expect(runEnvironments.starts.slice(started)).toEqual([
      expect.objectContaining({ taskId: TASK, projectId: project.id }),
    ]);
    expect(
      runEnvironments.runs
        .slice(ran)
        .map(({ task, command }) => [task.taskId, command.commandLine]),
    ).toEqual([
      [TASK, ON_THE_TASKS_BRANCH],
      [TASK, PASSES],
    ]);
  });

  it("waits for the check already running instead of starting another, and stops it on abort", async () => {
    withSetting("off", false);
    project = { ...project, commands: startingCommands({ build: SLEEPS, lint: "", test: "" }) };
    let starts = 0;
    const unsubscribe = events.subscribe(EnvironmentCheckStarted, () => void (starts += 1));
    const stop = new AbortController();

    const first = checks.check(project.id, { taskId: TASK, signal: stop.signal });
    const second = checks.check(project.id, { taskId: TASK });
    await expect(checks.start(project.id, { taskId: TASK })).rejects.toThrow(/already running/);
    stop.abort();
    const [answered, alsoAnswered] = await Promise.all([first, second]);
    unsubscribe();

    expect(answered.state).toBe("stopped");
    expect(alsoAnswered).toBe(answered);
    expect(starts).toBe(1);
  });

  it("leaves a check it joined running when its own signal aborts, answering it as it stands", async () => {
    withSetting("off", false);
    project = { ...project, commands: startingCommands({ build: SLEEPS, lint: "", test: "" }) };
    const starter = new AbortController();
    const joiner = new AbortController();

    const started = checks.check(project.id, { taskId: TASK, signal: starter.signal });
    const joined = checks.check(project.id, { taskId: TASK, signal: joiner.signal });
    await expect(checks.start(project.id, { taskId: TASK })).rejects.toThrow(/already running/);
    joiner.abort();
    const answeredToJoiner = await joined;

    expect(answeredToJoiner.state).toBe("running");
    await expect(checks.start(project.id, { taskId: TASK })).rejects.toThrow(/already running/);
    starter.abort();
    expect((await started).state).toBe("stopped");
  });
});
