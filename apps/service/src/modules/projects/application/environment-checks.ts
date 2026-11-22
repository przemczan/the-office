import { Injectable, Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { BusyWork } from "../../office-updates/index.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type {
  Check,
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
import { Worktrees, type ThrowawayWorktree } from "./worktrees.js";

/** How long each of the Project's commands may run in the check before it is ended. */
const COMMAND_TIMEOUT_MS = 30 * 60_000;

/** An environment check under way: what it has found so far, and how to stop it. */
interface RunningCheck {
  check: EnvironmentCheck;
  readonly stop: AbortController;
  done: Promise<void>;
}

/**
 * The environment check (spec §5.5): a throwaway worktree of the freshly fetched base branch,
 * then install and each of the Project's commands in it with the Project's saved environment; it
 * changes nothing. One runs at a time per Project; a running one lives here, and only finished
 * ones are kept, so a restart never finds one that was left running.
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
    private readonly repository: EnvironmentCheckRepository,
    private readonly events: EventBus,
    private readonly busyWork: BusyWork,
  ) {}

  /**
   * Starts a check of the Project's saved environment and returns it as it starts; it goes on in
   * the background. Refuses, running nothing, while a check is running.
   */
  async start(projectId: string): Promise<EnvironmentCheck> {
    const project = await this.projects.read(projectId);
    // Nothing is awaited from here until the check is held, so two starts can't both pass.
    if (this.running.has(projectId)) {
      throw new ProjectRefused(["An environment check is already running for this Project."]);
    }
    const { check, event } = startEnvironmentCheck(
      projectId,
      project,
      project.environment,
      new Date(),
    );
    const running: RunningCheck = { check, stop: new AbortController(), done: Promise.resolve() };
    this.running.set(projectId, running);
    const busy = {
      kind: "environment-check",
      label: `The environment check of the Project "${project.name}"`,
    } as const;
    running.done = this.busyWork
      .during(busy, () => this.run(project, running, event))
      .catch((error: unknown) => {
        this.logger.error(`The environment check of ${projectId} could not finish.`, error);
      });
    return check;
  }

  /** The check running for the Project, or else its last finished one. */
  async latest(projectId: string): Promise<EnvironmentCheck | undefined> {
    const running = this.running.get(projectId);
    if (running) return running.check;
    await this.projects.read(projectId);
    return this.repository.find(projectId);
  }

  /**
   * For every Project, the check running now, or else its last finished one; one repository read,
   * no Project is read.
   */
  async latestOfAll(): Promise<readonly EnvironmentCheck[]> {
    const finished = await this.repository.listAll();
    const running = [...this.running.values()].map((each) => each.check);
    return [...running, ...finished.filter(({ projectId }) => !this.running.has(projectId))];
  }

  /** Stops the running checks and waits for them to finish, while the database is still open. */
  async beforeApplicationShutdown(): Promise<void> {
    const running = [...this.running.values()];
    for (const each of running) each.stop.abort();
    await Promise.all(running.map((each) => each.done));
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
      if (worktree && (await this.install(project, worktree, running))) {
        for (const check of running.check.checks) {
          if (check.step !== "command" || check.state === "skipped") continue;
          await this.runCommand(check, worktree, running);
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
      const worktree = await this.worktrees.addThrowaway(project, running.check.environment);
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

  private async runCommand(
    check: CommandCheck,
    worktree: ThrowawayWorktree,
    running: RunningCheck,
  ): Promise<void> {
    if (running.stop.signal.aborted) return;
    await this.progress(running, { ...check, state: "running" });
    const { wholeOutput: _shownOnlyInTheStageHistory, ...run } = await this.commands.run({
      commandLine: check.commandLine,
      folder: worktree.path,
      environment: running.check.environment,
      timeoutMs: COMMAND_TIMEOUT_MS,
      signal: running.stop.signal,
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
    try {
      await this.repository.save(check);
      running.check = check;
    } finally {
      this.running.delete(project.id);
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
