import { Injectable, Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { CommandRun } from "../domain/command-run.js";
import type { Check, CommandCheck, EnvironmentCheck } from "../domain/environment-check.js";
import {
  finishEnvironmentCheck,
  progressEnvironmentCheck,
  startEnvironmentCheck,
} from "../domain/environment-check-changes.js";
import type { EnvironmentCheckStarted } from "../domain/environment-check-events.js";
import type { Project } from "../domain/project.js";
import { trimmedEnvironment, type ProjectEnvironment } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { EnvironmentCheckRepository } from "../ports/environment-check-repository.js";
import { GitCommandFailed } from "../ports/git.js";
import { ProjectChecks } from "./project-checks.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import { ProjectService } from "./project-service.js";
import { Worktrees, type ThrowawayWorktree } from "./worktrees.js";

/** How long build, lint or test may run in the check before it is ended. */
const COMMAND_TIMEOUT_MS = 30 * 60_000;

/** An environment check under way: what it has found so far, and how to stop it. */
interface RunningCheck {
  check: EnvironmentCheck;
  readonly stop: AbortController;
  done: Promise<void>;
}

/**
 * The environment check (spec §5.5): a throwaway worktree of the freshly fetched base branch,
 * then install, build, lint and test in it with the environment tried, which is saved only when
 * every check passes. One runs at a time per Project; a running one lives here, and only finished
 * ones are kept, so a restart never finds one that was left running.
 */
@Injectable()
export class EnvironmentChecks implements BeforeApplicationShutdown {
  private readonly logger = new Logger(EnvironmentChecks.name);
  private readonly running = new Map<string, RunningCheck>();

  constructor(
    private readonly projects: ProjectService,
    private readonly rules: ProjectChecks,
    private readonly worktrees: Worktrees,
    private readonly remotes: ProjectRemotes,
    private readonly commands: ProjectCommandRunner,
    private readonly repository: EnvironmentCheckRepository,
    private readonly events: EventBus,
  ) {}

  /**
   * Starts a check of `given` and returns it as it starts; it goes on in the background. Refuses
   * with every reason, running nothing, when the environment breaks a rule or a check is running.
   */
  async start(projectId: string, given: ProjectEnvironment): Promise<EnvironmentCheck> {
    const project = await this.projects.read(projectId);
    const environment = trimmedEnvironment(given);
    const problems = this.rules.environmentProblems(environment);
    // Nothing is awaited from here until the check is held, so two starts can't both pass.
    if (this.running.has(projectId)) {
      problems.push("An environment check is already running for this Project.");
    }
    if (problems.length > 0) throw new ProjectRefused(problems);
    const { check, event } = startEnvironmentCheck(
      projectId,
      project.commands,
      environment,
      new Date(),
    );
    const running: RunningCheck = { check, stop: new AbortController(), done: Promise.resolve() };
    this.running.set(projectId, running);
    running.done = this.run(project, running, event).catch((error: unknown) => {
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
          if (check.step === "worktree" || check.step === "install") continue;
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

  /** Whether the install passed. The Project's own install command is the one frozen at start. */
  private async install(
    project: Project,
    worktree: ThrowawayWorktree,
    running: RunningCheck,
  ): Promise<boolean> {
    const check = commandCheck(running.check, "install");
    await this.progress(running, { ...check, state: "running" });
    const installation = await this.worktrees.install(
      { ...project, commands: { ...project.commands, install: check.commandLine } },
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
    const run: CommandRun = await this.commands.run({
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

  /** Saves the environment when every check passed, then the check, and announces both. */
  private async finish(project: Project, running: RunningCheck, stopped: boolean): Promise<void> {
    const { check, event } = finishEnvironmentCheck(running.check, new Date(), stopped);
    try {
      if (check.state === "passed") {
        await this.projects.changeEnvironment(project.id, check.environment);
      }
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

function commandCheck(check: EnvironmentCheck, step: CommandCheck["step"]): CommandCheck {
  const found = check.checks.find((each): each is CommandCheck => each.step === step);
  if (!found) throw new Error(`The environment check has no ${step} check.`);
  return found;
}
