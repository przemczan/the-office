import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { Project } from "../domain/project.js";
import {
  needsStatus,
  openedPullRequest,
  taskIdOfBranch,
  withStatus,
  type PullRequest,
} from "../domain/pull-request.js";
import { PullRequestsChecked } from "../domain/pull-request-events.js";
import { CodeHost, CodeHostRefused, type PullRequestOnHost } from "../ports/code-host.js";
import { Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { PullRequestRepository } from "../ports/pull-request-repository.js";
import { CodeHosts } from "./code-hosts.js";

export const PULL_REQUEST_WATCH = "pull requests";
/** How long the watch waits after each round. */
export const PULL_REQUEST_WATCH_EVERY = 60_000;
/** A refresh asked sooner than this after the last round began answers that round. */
export const REFRESH_AT_MOST_EVERY = 10_000;

/**
 * Why a Project's pull requests couldn't be refreshed: its code host refused to be read, in its own
 * plain words, or failed; a failure keeps when it first failed and when the list was last read.
 */
type HeldProblem =
  | { readonly kind: "cannot-read"; readonly text: string }
  | {
      readonly kind: "unreachable";
      readonly codeHost: string;
      readonly failedAt: Date;
      readonly lastReadAt: Date | null;
    };

/** A Project's problem. */
export type PullRequestProblem = HeldProblem & { readonly projectId: string };

/** The open pull requests The Office opened, newest first, and each Project's problem. */
export interface PullRequestList {
  readonly pullRequests: readonly PullRequest[];
  readonly problems: readonly PullRequestProblem[];
}

/**
 * Keeps the pull requests The Office opened up to date with their code hosts, every minute and on
 * a refresh: per Project, the base branch's remote as git resolves it, one list of its open pull
 * requests, and a status read only for the ones whose commits moved or whose checks or merge state
 * the host hadn't worked out, plus one last read for each that left the list. A pull request on an
 * `office/<task id>` branch that isn't recorded, as when Publish couldn't record it, is adopted.
 * Nothing it can't read fails it: the rows go stale and the Project holds a problem in plain words
 * (kept in memory) until a round reads it again. `PullRequestsChecked` is published only when
 * something the list shows changed.
 */
@Injectable()
export class PullRequestWatch implements OnApplicationBootstrap {
  private readonly logger = new Logger(PullRequestWatch.name);
  private running: Promise<void> | undefined;
  private lastRoundAt: number | undefined;
  private readonly problems = new Map<string, HeldProblem>();
  /** When each Project's pull requests were last read whole, for a problem's words. */
  private readonly lastReadAt = new Map<string, Date>();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly git: Git,
    private readonly codeHosts: CodeHosts,
    private readonly pullRequests: PullRequestRepository,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule.every(PULL_REQUEST_WATCH, PULL_REQUEST_WATCH_EVERY, () => this.check());
  }

  /** The open pull requests and problems, only the Project's when one is named. */
  async list(projectId?: string): Promise<PullRequestList> {
    return {
      pullRequests: await this.pullRequests.listOpen(projectId),
      problems: [...this.problems]
        .filter(([id]) => projectId === undefined || id === projectId)
        .map(([id, problem]) => ({ ...problem, projectId: id })),
    };
  }

  /**
   * A round now, for the user's Refresh: the round under way when one is, and none when the last
   * began less than `REFRESH_AT_MOST_EVERY` ago, so a page refreshed again and again asks the hosts
   * once.
   */
  refresh(): Promise<void> {
    if (this.running) return this.running;
    const now = this.schedule.now().getTime();
    if (this.lastRoundAt !== undefined && now - this.lastRoundAt < REFRESH_AT_MOST_EVERY) {
      return Promise.resolve();
    }
    return this.check();
  }

  /** A round, or the one under way: never two at once. */
  check(): Promise<void> {
    this.running ??= this.round().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async round(): Promise<void> {
    const at = this.schedule.now();
    this.lastRoundAt = at.getTime();
    const changed: string[] = [];
    const projects = await this.projects.list();
    this.forgetProjectsGone(projects);
    for (const project of projects) {
      try {
        if (await this.checkProject(project, at)) changed.push(project.id);
      } catch (error) {
        this.logger.warn(
          `Refreshing the pull requests of ${project.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (changed.length > 0) await this.events.publish(new PullRequestsChecked(changed, at));
  }

  /** Refreshes one Project's pull requests; true when anything the list shows changed. */
  private async checkProject(project: Project, at: Date): Promise<boolean> {
    const remoteUrl = await this.remoteUrlOf(project);
    const host = remoteUrl === undefined ? undefined : this.codeHosts.of(remoteUrl);
    if (remoteUrl === undefined || host === undefined) return this.hold(project.id, undefined);
    const kept = (await this.pullRequests.listOpen(project.id)).filter(
      (pullRequest) => pullRequest.remoteUrl === remoteUrl,
    );
    const cannotRead = await host.whyCannotRead(remoteUrl);
    if (cannotRead !== undefined) {
      const staled = await this.markStale(kept);
      return this.hold(project.id, { kind: "cannot-read", text: cannotRead }) || staled;
    }
    try {
      const changed = await this.read(project, host, remoteUrl, kept, at);
      this.lastReadAt.set(project.id, at);
      return this.hold(project.id, undefined) || changed;
    } catch (error) {
      if (!(error instanceof CodeHostRefused)) throw error;
      const staled = await this.markStale(
        (await this.pullRequests.listOpen(project.id)).filter(
          (pullRequest) => pullRequest.remoteUrl === remoteUrl,
        ),
      );
      const raised = this.hold(project.id, {
        kind: "unreachable",
        codeHost: host.name,
        failedAt: at,
        lastReadAt: this.lastReadAt.get(project.id) ?? null,
      });
      if (raised) {
        this.logger.warn(
          `${host.name} failed reading ${project.name}'s pull requests: ${error.message}`,
        );
      }
      return raised || staled;
    }
  }

  /** One list of the remote's open pull requests, and a status read only where it may have moved. */
  private async read(
    project: Project,
    host: CodeHost,
    remoteUrl: string,
    kept: readonly PullRequest[],
    at: Date,
  ): Promise<boolean> {
    const listed = await host.openPullRequests(remoteUrl);
    const keptByNumber = new Map(kept.map((pullRequest) => [pullRequest.number, pullRequest]));
    let changed = false;
    for (const onHost of listed) {
      const known = keptByNumber.get(onHost.number);
      const pullRequest = known ?? (await this.adopt(project, remoteUrl, onHost, at));
      if (pullRequest === undefined) continue;
      if (!known) changed = true;
      if (needsStatus(pullRequest, onHost)) {
        changed = (await this.readStatus(host, remoteUrl, pullRequest, at)) || changed;
      } else if (pullRequest.stale) {
        await this.pullRequests.save({ ...pullRequest, stale: false });
        changed = true;
      }
    }
    const listedNumbers = new Set(listed.map((onHost) => onHost.number));
    for (const pullRequest of kept) {
      // Merged or closed since: its last status, and when it ended.
      if (!listedNumbers.has(pullRequest.number)) {
        changed = (await this.readStatus(host, remoteUrl, pullRequest, at)) || changed;
      }
    }
    return changed;
  }

  /** Records a pull request on a Task's branch that Publish didn't record; undefined for others. */
  private async adopt(
    project: Project,
    remoteUrl: string,
    onHost: PullRequestOnHost,
    at: Date,
  ): Promise<PullRequest | undefined> {
    const taskId = taskIdOfBranch(onHost.branch);
    if (taskId === undefined) return undefined;
    return this.pullRequests.record(
      openedPullRequest({
        id: randomUUID(),
        projectId: project.id,
        taskId,
        remoteUrl,
        number: onHost.number,
        url: onHost.url,
        title: onHost.title,
        branch: onHost.branch,
        baseBranch: onHost.baseBranch,
        openedAt: at,
      }),
    );
  }

  private async readStatus(
    host: CodeHost,
    remoteUrl: string,
    pullRequest: PullRequest,
    at: Date,
  ): Promise<boolean> {
    const status = await host.pullRequestStatus(remoteUrl, pullRequest.number);
    const read = withStatus(pullRequest, status, at);
    await this.pullRequests.save(read.pullRequest);
    return read.changed;
  }

  /** Marks the pull requests stale; true when any wasn't already. */
  private async markStale(kept: readonly PullRequest[]): Promise<boolean> {
    const fresh = kept.filter((pullRequest) => !pullRequest.stale);
    for (const pullRequest of fresh) await this.pullRequests.save({ ...pullRequest, stale: true });
    return fresh.length > 0;
  }

  /**
   * Holds the Project's problem, or clears it with undefined; true when it changed. A host still
   * failing keeps its first failure, so a long outage isn't news every minute.
   */
  private hold(projectId: string, problem: HeldProblem | undefined): boolean {
    const held = this.problems.get(projectId);
    if (problem === undefined) return this.problems.delete(projectId);
    if (held?.kind === "unreachable" && problem.kind === "unreachable") return false;
    if (
      held?.kind === "cannot-read" &&
      problem.kind === "cannot-read" &&
      held.text === problem.text
    ) {
      return false;
    }
    this.problems.set(projectId, problem);
    return true;
  }

  /** Drops what is held of Projects removed since, so their problems aren't shown. */
  private forgetProjectsGone(projects: readonly Project[]): void {
    const ids = new Set(projects.map((project) => project.id));
    for (const held of [this.problems, this.lastReadAt]) {
      for (const projectId of held.keys()) if (!ids.has(projectId)) held.delete(projectId);
    }
  }

  /** The base branch's remote URL as git resolves it; undefined without one or when git fails. */
  private async remoteUrlOf(project: Project): Promise<string | undefined> {
    try {
      const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
      return upstream && (await this.git.fetchUrlOf(project.path, upstream.remote));
    } catch {
      // A Project whose folder is gone or broken has no pull requests to read; its page says why.
      return undefined;
    }
  }
}
