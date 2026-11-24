import { Injectable, Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { BusyWork } from "../../office-updates/index.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type {
  Check,
  CheckedCommandRun,
  CommandCheck,
  EnvironmentCheck,
  InstallCheck,
} from "../domain/environment-check.js";
import {
  finishEnvironmentCheck,
  progressEnvironmentCheck,
  startEnvironmentCheck,
} from "../domain/environment-check-changes.js";
import type { EnvironmentCheckStarted } from "../domain/environment-check-events.js";
import type { Project } from "../domain/project.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { EnvironmentCheckRepository } from "../ports/environment-check-repository.js";
import { GitCommandFailed } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import { ProjectService } from "./project-service.js";
import { TaskCommandRunner } from "./task-command-runner.js";
import { Worktrees, type ThrowawayWorktree } from "./worktrees.js";

/** How long each of the Project's commands may run in the check before it is ended. */
const COMMAND_TIMEOUT_MS = 30 * 60_000;

/** Which check of a Project's or a Task's: the Task's when given. */
export interface EnvironmentCheckOptions {
  /**
   * Checks the head of the Task's branch, in the Task's run environment when its commands run
   * there.
   */
  readonly taskId?: string;
}

/** How a check waited for is stopped. */
export interface AwaitedEnvironmentCheckOptions extends EnvironmentCheckOptions {
  /** Stops the check, when still running, and answers it stopped. */
  readonly signal?: AbortSignal;
}

/** An environment check under way: what it has found so far, and how to stop it. */
interface RunningCheck {
  check: EnvironmentCheck;
  readonly stop: AbortController;
  done: Promise<void>;
  /** Whether install and the commands run in the Task's run environment, once its worktree is. */
  inRunEnvironment: boolean;
}

/**
 * The environment check (spec §5.5): a throwaway worktree of the freshly fetched base branch, or
 * of the head of a Task's branch, then install and each of the Project's commands in it with the
 * Project's saved environment, on the host or, for a Task whose commands run there, in its run
 * environment; it changes nothing. One runs at a time per Project for its base branch and one per
 * Task; a running one lives here, and only finished ones are kept, the Project's last one, so a
 * restart never finds one that was left running.
 */
@Injectable()
export class EnvironmentChecks implements BeforeApplicationShutdown {
  private readonly logger = new Logger(EnvironmentChecks.name);
  private readonly running = new Map<string, RunningCheck>();

  constructor(
    private readonly projects: ProjectService,
    private readonly worktrees: Worktrees,
    private readonly remotes: ProjectRemotes,
    private readonly commands: ProjectCommandRunner,
    private readonly taskCommands: TaskCommandRunner,
    private readonly repository: EnvironmentCheckRepository,
    private readonly events: EventBus,
    private readonly busyWork: BusyWork,
  ) {}

  /**
   * Starts a check of the Project's saved environment, of the Task's branch when `taskId` is given,
   * and returns it as it starts; it goes on in the background. Refuses, running nothing, while a
   * check of the same (the Project's base branch, or the Task's branch) is running.
   */
  async start(projectId: string, options: EnvironmentCheckOptions = {}): Promise<EnvironmentCheck> {
    const project = await this.projects.read(projectId);
    if (options.taskId !== undefined) await this.refuseWithoutBranch(project, options.taskId);
    // Nothing is awaited from here until the check is held, so two starts can't both pass.
    if (this.running.has(keyOf(projectId, options))) {
      throw new ProjectRefused([
        options.taskId === undefined
          ? "An environment check is already running for this Project."
          : "An environment check is already running for this Task.",
      ]);
    }
    return this.begin(project, options).check;
  }

  /**
   * Checks the Project's saved environment, of the Task's branch when `taskId` is given, and
   * answers the check once it finished. A check of the same already running is waited for, with
   * no other started. When `signal` aborts, a check this call started is stopped and answered
   * stopped; one it joined goes on for whoever started it, and is answered as it stands.
   */
  async check(
    projectId: string,
    { signal, ...options }: AwaitedEnvironmentCheckOptions = {},
  ): Promise<EnvironmentCheck> {
    const project = await this.projects.read(projectId);
    const joined = this.running.get(keyOf(projectId, options));
    const running = joined ?? this.begin(project, options);
    if (joined === undefined) {
      const stop = () => running.stop.abort();
      if (signal?.aborted) stop();
      signal?.addEventListener("abort", stop, { once: true });
      try {
        await running.done;
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    } else {
      await untilDoneOrAborted(running.done, signal);
    }
    return running.check;
  }

  /** The newest check running for the Project, a Task's among them, or else its last finished. */
  async latest(projectId: string): Promise<EnvironmentCheck | undefined> {
    const running = this.newestRunning().get(projectId);
    if (running) return running;
    await this.projects.read(projectId);
    return this.repository.find(projectId);
  }

  /**
   * For every Project, the newest check running now, or else its last finished one; one
   * repository read, no Project is read.
   */
  async latestOfAll(): Promise<readonly EnvironmentCheck[]> {
    const finished = await this.repository.listAll();
    const running = this.newestRunning();
    return [...running.values(), ...finished.filter(({ projectId }) => !running.has(projectId))];
  }

  /** Stops the running checks and waits for them to finish, while the database is still open. */
  async beforeApplicationShutdown(): Promise<void> {
    const running = [...this.running.values()];
    for (const each of running) each.stop.abort();
    await Promise.all(running.map((each) => each.done));
  }

  /**
   * Refuses a Task whose branch the Project's repository doesn't have: one of another Project, one
   * not started yet, or no Task at all (Work's lookup throws for it).
   */
  private async refuseWithoutBranch(project: Project, taskId: string): Promise<void> {
    const tip = await this.worktrees.taskBranchTip(project, taskId).catch(() => undefined);
    if (tip === undefined) {
      throw new ProjectRefused([
        `The Task ${taskId} has no branch in the Project "${project.name}": check a Task of this Project once it has started.`,
      ]);
    }
  }

  /** Holds a new check and runs it in the background. */
  private begin(project: Project, options: EnvironmentCheckOptions): RunningCheck {
    const key = keyOf(project.id, options);
    const { check, event } = startEnvironmentCheck(
      project.id,
      project,
      project.environment,
      new Date(),
      options.taskId,
    );
    const running: RunningCheck = {
      check,
      stop: new AbortController(),
      done: Promise.resolve(),
      inRunEnvironment: false,
    };
    this.running.set(key, running);
    const busy = {
      kind: "environment-check",
      label:
        options.taskId === undefined
          ? `The environment check of the Project "${project.name}"`
          : `The environment check of a Task's branch of the Project "${project.name}"`,
    } as const;
    running.done = this.busyWork
      .during(busy, () => this.run(project, running, event))
      .catch((error: unknown) => {
        this.logger.error(`The environment check of ${key} could not finish.`, error);
      })
      .finally(() => {
        // finish lets go of it; this is for a check that broke off before.
        if (this.running.get(key) === running) this.running.delete(key);
      });
    return running;
  }

  /** The newest running check of each Project, by its id. */
  private newestRunning(): Map<string, EnvironmentCheck> {
    const newest = new Map<string, EnvironmentCheck>();
    for (const { check } of this.running.values()) {
      const found = newest.get(check.projectId);
      if (!found || found.startedAt < check.startedAt) newest.set(check.projectId, check);
    }
    return newest;
  }

  private async run(
    project: Project,
    running: RunningCheck,
    started: EnvironmentCheckStarted,
  ): Promise<void> {
    const { environment } = running.check;
    const signal = running.stop.signal;
    let worktree: ThrowawayWorktree | undefined;
    try {
      await this.events.publish(started);
      worktree = await this.openWorktree(project, running);
      const taskId = running.check.taskId;
      running.inRunEnvironment =
        worktree !== undefined &&
        taskId !== undefined &&
        (await this.taskCommands.usesRunEnvironment(project, taskId));
      if (worktree && (await this.install(project, worktree, running))) {
        for (const check of running.check.checks) {
          if (check.step !== "command" || check.state === "skipped") continue;
          await this.runCommand(project, check, worktree, running);
        }
      }
    } catch (error) {
      this.logger.error(`The environment check of ${project.id} broke off.`, error);
    } finally {
      if (worktree) await this.removeWorktree(project, worktree, environment);
      await this.finish(project, running, signal.aborted);
    }
  }

  private async openWorktree(
    project: Project,
    running: RunningCheck,
  ): Promise<ThrowawayWorktree | undefined> {
    await this.progress(running, { step: "worktree", state: "running" });
    try {
      const { taskId, environment } = running.check;
      const worktree =
        taskId === undefined
          ? await this.worktrees.addThrowaway(project, environment)
          : await this.worktrees.addThrowawayOfTask(project, taskId, environment);
      const { commit, fetchedFrom } = worktree.base;
      await this.progress(running, {
        step: "worktree",
        state: "passed",
        base: {
          commit,
          fetchedFrom: fetchedFrom && `${fetchedFrom.remote}/${fetchedFrom.branch}`,
        },
      });
      return worktree;
    } catch (error) {
      await this.progress(running, {
        step: "worktree",
        state: "failed",
        problem: await this.worktreeProblem(project, error),
      });
      return undefined;
    }
  }

  /** git's own words, and for a failed fetch what the Office identity lacks for the remote. */
  private async worktreeProblem(project: Project, error: unknown): Promise<string> {
    const problem = error instanceof Error ? error.message : String(error);
    const fetchFailed = error instanceof GitCommandFailed && error.gitArguments[0] === "fetch";
    const reason = fetchFailed ? await this.remotes.whyFetchFailed(project) : undefined;
    return reason === undefined ? problem : `${reason} ${problem}`;
  }

  /**
   * Whether the install passed, or there is nothing to install as the Project's install command
   * isn't set. The Project's own install command is the one frozen at start.
   */
  private async install(
    project: Project,
    worktree: ThrowawayWorktree,
    running: RunningCheck,
  ): Promise<boolean> {
    const check = installCheck(running.check);
    if (check.state === "skipped") return true;
    await this.progress(running, { ...check, state: "running" });
    const { taskId } = running.check;
    if (running.inRunEnvironment && taskId !== undefined) {
      return this.startRunEnvironment(project, taskId, check, worktree, running);
    }
    const installation = await this.worktrees.install(
      { ...project, installCommand: check.commandLine },
      worktree.path,
      { environment: running.check.environment, signal: running.stop.signal },
    );
    // A fresh worktree has never installed, so its install always runs.
    const run = installation.kind === "ran" ? installation.run : undefined;
    const passed = run?.outcome === "passed";
    await this.progress(running, { ...check, state: passed ? "passed" : "failed", run });
    return passed;
  }

  /**
   * In the Task's run environment, install is its image's: it passes once the run environment
   * starts, and fails with every reason it couldn't.
   */
  private async startRunEnvironment(
    project: Project,
    taskId: string,
    check: InstallCheck,
    worktree: ThrowawayWorktree,
    running: RunningCheck,
  ): Promise<boolean> {
    const startedAt = Date.now();
    const reasons = await this.taskCommands.startRunEnvironment(project, taskId, worktree.path);
    const passed = reasons.length === 0;
    const run: CheckedCommandRun = {
      commandLine: check.commandLine,
      outcome: passed ? "passed" : "could-not-run",
      exitCode: undefined,
      durationMs: Date.now() - startedAt,
      output: reasons.join("\n"),
    };
    await this.progress(running, { ...check, state: passed ? "passed" : "failed", run });
    return passed;
  }

  private async runCommand(
    project: Project,
    check: CommandCheck,
    worktree: ThrowawayWorktree,
    running: RunningCheck,
  ): Promise<void> {
    if (running.stop.signal.aborted) return;
    await this.progress(running, { ...check, state: "running" });
    const { taskId, environment } = running.check;
    const signal = running.stop.signal;
    const { wholeOutput: _shownOnlyInTheStageHistory, ...run } =
      running.inRunEnvironment && taskId !== undefined
        ? await this.taskCommands.run({ ...project, environment }, taskId, worktree.path, {
            commandLine: check.commandLine,
            timeoutMs: COMMAND_TIMEOUT_MS,
            signal,
          })
        : await this.commands.run({
            commandLine: check.commandLine,
            folder: worktree.path,
            environment,
            timeoutMs: COMMAND_TIMEOUT_MS,
            signal,
          });
    await this.progress(running, {
      ...check,
      state: run.outcome === "passed" ? "passed" : "failed",
      run,
    });
  }

  private async removeWorktree(
    project: Project,
    worktree: ThrowawayWorktree,
    environment: ProjectEnvironment,
  ): Promise<void> {
    // One left behind is removed by the Project's next check; it doesn't change this one's result.
    await this.worktrees.removeThrowaway(project, worktree.path, environment).catch((error) => {
      this.logger.warn(`The environment check's worktree stays at ${worktree.path}.`, error);
    });
  }

  /** Saves the finished check and announces it. */
  private async finish(project: Project, running: RunningCheck, stopped: boolean): Promise<void> {
    const { check, event } = finishEnvironmentCheck(running.check, new Date(), stopped);
    // Set before it is kept, so one waited for is answered finished even when it can't be kept.
    running.check = check;
    try {
      await this.repository.save(check);
    } finally {
      this.running.delete(keyOf(project.id, check));
    }
    await this.events.publish(event);
  }

  private async progress(running: RunningCheck, updated: Check): Promise<void> {
    const { check, event } = progressEnvironmentCheck(running.check, updated);
    running.check = check;
    await this.events.publish(event);
  }
}

function installCheck(check: EnvironmentCheck): InstallCheck {
  const found = check.checks.find((each): each is InstallCheck => each.step === "install");
  if (!found) throw new Error("The environment check has no install check.");
  return found;
}

/** What runs one at a time: the Project's base branch's check, or the Task's. */
function keyOf(projectId: string, { taskId }: EnvironmentCheckOptions): string {
  return taskId === undefined ? `project:${projectId}` : `task:${taskId}`;
}

/** Resolves once `done` does, or as soon as `signal` aborts, leaving what `done` waits on running. */
async function untilDoneOrAborted(
  done: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal === undefined) return done;
  if (signal.aborted) return;
  const listening = new AbortController();
  const aborted = new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true, signal: listening.signal });
  });
  try {
    await Promise.race([done, aborted]);
  } finally {
    listening.abort();
  }
}
