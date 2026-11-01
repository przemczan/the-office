import { randomUUID } from "node:crypto";
import { rmdir } from "node:fs/promises";
import { Injectable, Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import { ProjectRefused } from "../domain/project-refused.js";
import {
  RepositoryCloneNotFound,
  type CloneProgress,
  type RepositoryClone,
  type RepositoryCloneOutcome,
} from "../domain/repository-clone.js";
import {
  RepositoryCloneFinished,
  RepositoryCloneProgressed,
  RepositoryCloneStarted,
} from "../domain/repository-clone-events.js";
import { CLONE_REMOTE, Git, GitCommandFailed } from "../ports/git.js";
import { ProjectRemotes } from "./project-remotes.js";
import { ProjectService } from "./project-service.js";
import { clonePathOf, readRepositoryUrl, type RepositoryUrl } from "./repository-url.js";

/** A clone under way: what it has done so far, and how to stop it. */
interface RunningClone {
  clone: RepositoryClone;
  readonly stop: AbortController;
  done: Promise<void>;
}

/**
 * Clones a repository by its Repository URL into `<office-data>/repositories/<host>/<path>`
 * (spec §5.5 Defaults), in the background with its progress told as events, before it is added
 * as a Project by that path. A complete clone left there by an add that never happened is used
 * again. Clones live only here, as long as the service runs: the Project keeps what matters.
 */
@Injectable()
export class RepositoryClones implements BeforeApplicationShutdown {
  private readonly logger = new Logger(RepositoryClones.name);
  private readonly operatingSystem = currentOperatingSystem();
  private readonly clones = new Map<string, RunningClone>();

  constructor(
    private readonly git: Git,
    private readonly remotes: ProjectRemotes,
    private readonly projects: ProjectService,
    private readonly officeData: OfficeDataDirectory,
    private readonly events: EventBus,
  ) {}

  /**
   * Starts cloning `url` and returns the clone as it starts; it goes on in the background. Refuses,
   * cloning nothing, a URL The Office doesn't clone, one it can't reach yet, a repository that is
   * already a Project and one being cloned.
   */
  async start(url: string): Promise<RepositoryClone> {
    const reading = readRepositoryUrl(url);
    if (reading.kind === "refused") throw new ProjectRefused([reading.problem]);
    const { repositoryUrl } = reading;
    const path = clonePathOf(this.officeData.folder("repositories"), repositoryUrl);
    const problems = await this.problems(repositoryUrl, path);
    // Nothing is awaited from here until the clone is held, so two starts can't both pass.
    if (this.isCloning(path)) problems.push("The repository is being cloned already.");
    if (problems.length > 0) throw new ProjectRefused(problems);
    const clone: RepositoryClone = {
      id: randomUUID(),
      url: repositoryUrl.url,
      path,
      startedAt: new Date(),
      finishedAt: undefined,
      state: "cloning",
      progress: undefined,
    };
    const running: RunningClone = { clone, stop: new AbortController(), done: Promise.resolve() };
    this.clones.set(clone.id, running);
    running.done = this.run(running).catch((error: unknown) => {
      this.logger.error(`The clone of ${clone.url} could not finish.`, error);
    });
    return clone;
  }

  read(cloneId: string): RepositoryClone {
    const running = this.clones.get(cloneId);
    if (!running) throw new RepositoryCloneNotFound(cloneId);
    return running.clone;
  }

  /** Stops the running clones and waits for them to finish. */
  async beforeApplicationShutdown(): Promise<void> {
    const running = [...this.clones.values()];
    for (const each of running) each.stop.abort();
    await Promise.all(running.map((each) => each.done));
  }

  private async problems(repositoryUrl: RepositoryUrl, path: string): Promise<string[]> {
    const problems: string[] = [];
    const tooLong = this.operatingSystem.paths.lengthProblem(path, "directory");
    if (tooLong !== undefined)
      problems.push(`The clone's folder, ${path}, is too long: ${tooLong}`);
    const unreachable = await this.remotes.whyUnreachable(repositoryUrl.url);
    if (unreachable !== undefined) problems.push(unreachable);
    const project = await this.projects.findByPath(path);
    if (project) problems.push(`The repository is already the Project "${project.name}".`);
    return problems;
  }

  private isCloning(path: string): boolean {
    return [...this.clones.values()].some(
      ({ clone }) => clone.state === "cloning" && clone.path === path,
    );
  }

  private async run(running: RunningClone): Promise<void> {
    const { url, path } = running.clone;
    await this.events.publish(new RepositoryCloneStarted(running.clone));
    let outcome: RepositoryCloneOutcome;
    try {
      outcome = await this.cloned(running);
    } catch (error) {
      outcome = { state: "failed", problem: await this.problemOf(error, running) };
      if (!(error instanceof GitCommandFailed) && !running.stop.signal.aborted) {
        this.logger.error(`The clone of ${url} into ${path} broke off.`, error);
      }
    }
    running.clone = { ...running.clone, ...outcome, finishedAt: new Date() };
    await this.events.publish(new RepositoryCloneFinished(running.clone));
  }

  /** Reads the remote's branches first, which fails fast, then clones unless a clone is there. */
  private async cloned(running: RunningClone): Promise<RepositoryCloneOutcome> {
    const { url, path } = running.clone;
    const { defaultBranch, branches } = await this.git.remoteBranches(url);
    if (defaultBranch === undefined) {
      return {
        state: "failed",
        problem: "The repository has no commits yet, so no branch to work from.",
      };
    }
    const found = await this.git.inspect(path);
    if (found.kind === "repository") {
      // Another spelling of the URL shares the folder, maybe over the other transport: the clone
      // is fetched from the URL given last, which is the one its Project keeps.
      await this.git.setFetchUrl(path, CLONE_REMOTE, url);
    } else {
      if (found.kind !== "missing") await this.removeEmptyFolder(path);
      await this.git.clone({
        url,
        folder: path,
        onProgress: (progress) => void this.progress(running, progress),
        signal: running.stop.signal,
      });
    }
    return { state: "cloned", defaultBranch, branches };
  }

  /** An empty folder makes way for the clone; anything else there is the user's to remove. */
  private async removeEmptyFolder(path: string): Promise<void> {
    try {
      await rmdir(path);
    } catch {
      throw new ProjectRefused([`Something else is in ${path}: move it away to clone there.`]);
    }
  }

  private async problemOf(error: unknown, running: RunningClone): Promise<string> {
    if (running.stop.signal.aborted) return "The Office stopped before the clone finished.";
    if (error instanceof ProjectRefused) return error.reasons.join(" ");
    if (!(error instanceof GitCommandFailed))
      return "The clone broke off; the service's log says why.";
    const reason = await this.remotes.whyCloneFailed(running.clone.url);
    return reason ?? `git couldn't clone the repository: ${error.detail}`;
  }

  /** Told only when the phase or its percentage changes, as git repeats both often. */
  private async progress(running: RunningClone, progress: CloneProgress): Promise<void> {
    const { clone } = running;
    if (clone.state !== "cloning") return;
    const last = clone.progress;
    if (last?.phase === progress.phase && last.percent === progress.percent) return;
    running.clone = { ...clone, progress };
    await this.events.publish(new RepositoryCloneProgressed(clone.id, progress));
  }
}
