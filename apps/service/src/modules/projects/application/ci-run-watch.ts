import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { isGoing, taskIdOf } from "../domain/ci-run.js";
import { CiRunsChecked } from "../domain/ci-run-events.js";
import type { Project } from "../domain/project.js";
import { CodeHost, CodeHostRefused, type CiRunOnHost } from "../ports/code-host.js";
import { Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { CodeHosts } from "./code-hosts.js";

export const CI_RUN_WATCH = "ci runs";
/** How long the watch waits after each round: a Project with a run going is listed this often. */
export const CI_RUN_WATCH_EVERY = 15_000;
/** How often a Project with no run going is listed again. */
export const IDLE_CI_RUNS_EVERY = 60_000;
/** A refresh asked sooner than this after the last one, for the same Project or all, asks nothing. */
export const CI_REFRESH_AT_MOST_EVERY = 10_000;
/**
 * How long after a start by hand its Project is listed every round, as the start answers with no
 * run to watch: its run shows within a round of the host listing it.
 */
export const EXPECTED_RUN_WITHIN = 60_000;
/** How many of a Project's newest runs are listed. */
export const CI_RUNS_LISTED = 30;

/**
 * Why a Project's CI runs couldn't be listed: its code host refused, in its own plain words, or
 * failed in a way that isn't a refusal, with when it first failed.
 */
export type CiRunProblem =
  | { readonly kind: "cannot-read"; readonly text: string }
  | { readonly kind: "unreachable"; readonly codeHost: string; readonly failedAt: Date };

/** A run of one of the Projects, with the Task whose branch it ran on. */
export interface CiRun extends CiRunOnHost {
  readonly projectId: string;
  readonly taskId: string | null;
}

/** Where one Project's listing stands. */
export interface CiRunListing {
  readonly projectId: string;
  /** When its runs were last listed whole; null when not since the service started. */
  readonly checkedAt: Date | null;
  readonly stale: boolean;
  readonly problem: CiRunProblem | null;
}

/** The runs, newest first, and each Project's listing. */
export interface CiRunList {
  readonly runs: readonly CiRun[];
  readonly projects: readonly CiRunListing[];
}

/** The Project's base branch remote and the code host that holds it. */
export interface ProjectOnHost {
  readonly remoteUrl: string;
  readonly host: CodeHost;
}

interface Listing {
  readonly runs: readonly CiRunOnHost[];
  readonly checkedAt: Date | null;
  readonly stale: boolean;
  readonly problem: CiRunProblem | null;
  /** When it was last due and looked at, listed or not, so an idle one waits its minute. */
  readonly triedAt: Date;
}

/**
 * Keeps each Project's recent CI runs in memory, read from the code host that holds its base
 * branch's remote: every `CI_RUN_WATCH_EVERY` a round lists again each Project with a run going,
 * each listed `IDLE_CI_RUNS_EVERY` ago or more, each a refresh or a re-run asked for, and each
 * expecting a run started by hand for `EXPECTED_RUN_WITHIN`. No table
 * keeps them: after a restart the first round lists them all. Without a sign-in valid now the
 * runs only go stale; a host failure keeps the last runs, stale, and holds the problem in plain
 * words. `CiRunsChecked` is published only when the runs, their staleness or a problem changed.
 */
@Injectable()
export class CiRunWatch implements OnApplicationBootstrap {
  private readonly logger = new Logger(CiRunWatch.name);
  private readonly listings = new Map<string, Listing>();
  /** The Projects a refresh or re-run asked to list at the next round, whether due or not. */
  private asked = new Set<string>();
  private askedAll = false;
  /** When a refresh was last asked, by Project id, or "" for one of all of them. */
  private readonly refreshedAt = new Map<string, number>();
  /** Until when each Project expecting a run started by hand is listed every round. */
  private readonly expecting = new Map<string, number>();
  private running: Promise<void> | undefined;

  constructor(
    private readonly projects: ProjectRepository,
    private readonly git: Git,
    private readonly codeHosts: CodeHosts,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule.every(CI_RUN_WATCH, CI_RUN_WATCH_EVERY, () => this.check());
  }

  /** The runs, newest first, and the listings: only the Project's when one is named. */
  list(projectId?: string): CiRunList {
    const listed = [...this.listings].filter(([id]) => projectId === undefined || id === projectId);
    return {
      runs: listed
        .flatMap(([id, listing]) =>
          listing.runs.map((run) => ({ ...run, projectId: id, taskId: taskIdOf(run) })),
        )
        .toSorted(newestFirst),
      projects: listed.map(([id, { checkedAt, stale, problem }]) => ({
        projectId: id,
        checkedAt,
        stale,
        problem,
      })),
    };
  }

  /** Run `runId` of the Project as last listed; undefined when the last listing didn't hold it. */
  runOf(projectId: string, runId: number): CiRunOnHost | undefined {
    return this.listings.get(projectId)?.runs.find((run) => run.id === runId);
  }

  /**
   * A round now, listing the Project, or every Project, whether due or not: the round under way
   * when one is, and nothing when the same was asked less than `CI_REFRESH_AT_MOST_EVERY` ago, so
   * a page refreshed again and again asks the host once. `force`, as after a re-run, lists the
   * Project in a round that starts after it was asked, every time.
   */
  refresh(projectId?: string, { force = false }: { readonly force?: boolean } = {}): Promise<void> {
    if (force && projectId !== undefined) {
      this.asked.add(projectId);
      // A round under way may have listed it before it was asked: the next one lists it.
      const underWay = this.running ?? Promise.resolve();
      return underWay.then(
        () => this.check(),
        () => this.check(),
      );
    }
    if (this.running) return this.running;
    const key = projectId ?? "";
    const now = this.schedule.now().getTime();
    const last = this.refreshedAt.get(key);
    if (last !== undefined && now - last < CI_REFRESH_AT_MOST_EVERY) return Promise.resolve();
    this.refreshedAt.set(key, now);
    if (projectId === undefined) this.askedAll = true;
    else this.asked.add(projectId);
    return this.check();
  }

  /**
   * Lists the Project now, as `refresh` with `force` does, then every round for
   * `EXPECTED_RUN_WITHIN`, so a run started by hand shows soon after the host lists it. Asked
   * again, the window starts again.
   */
  expectRun(projectId: string): Promise<void> {
    this.expecting.set(projectId, this.schedule.now().getTime() + EXPECTED_RUN_WITHIN);
    return this.refresh(projectId, { force: true });
  }

  /** A round, or the one under way: never two at once. */
  check(): Promise<void> {
    this.running ??= this.round().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** The Project's base branch remote and its code host; undefined when no host holds it. */
  async onHost(project: Project): Promise<ProjectOnHost | undefined> {
    const remoteUrl = await this.remoteUrlOf(project);
    const host = remoteUrl === undefined ? undefined : this.codeHosts.of(remoteUrl);
    return remoteUrl === undefined || host === undefined ? undefined : { remoteUrl, host };
  }

  private async round(): Promise<void> {
    const at = this.schedule.now();
    const asked = this.asked;
    const askedAll = this.askedAll;
    this.asked = new Set();
    this.askedAll = false;
    const projects = await this.projects.list();
    this.forgetProjectsGone(projects);
    const changed: string[] = [];
    for (const project of projects) {
      if (!askedAll && !asked.has(project.id) && !this.isDue(project.id, at)) continue;
      try {
        if (await this.checkProject(project, at)) changed.push(project.id);
      } catch (error) {
        this.logger.warn(
          `Listing the CI runs of ${project.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (changed.length > 0) await this.events.publish(new CiRunsChecked(changed, at));
  }

  /** Never listed, expecting a run, a run going, or idle for `IDLE_CI_RUNS_EVERY`. */
  private isDue(projectId: string, at: Date): boolean {
    const until = this.expecting.get(projectId);
    if (until !== undefined) {
      if (at.getTime() <= until) return true;
      this.expecting.delete(projectId);
    }
    const listing = this.listings.get(projectId);
    if (listing === undefined) return true;
    if (listing.runs.some(isGoing)) return true;
    return at.getTime() - listing.triedAt.getTime() >= IDLE_CI_RUNS_EVERY;
  }

  /** Lists one Project's runs; true when its runs, staleness or problem changed. */
  private async checkProject(project: Project, at: Date): Promise<boolean> {
    const onHost = await this.onHost(project);
    if (onHost === undefined) return this.listings.delete(project.id);
    const { remoteUrl, host } = onHost;
    const held = this.listings.get(project.id);
    const kept: Listing = held ?? {
      runs: [],
      checkedAt: null,
      stale: false,
      problem: null,
      triedAt: at,
    };
    if ((await host.whyCannotRead(remoteUrl)) !== undefined) {
      // Nobody signed in with a token valid now: nothing to ask, and nothing the user didn't know.
      return this.keep(project.id, held, { ...kept, stale: true, problem: null, triedAt: at });
    }
    try {
      const runs = await host.recentRuns(remoteUrl, CI_RUNS_LISTED);
      return this.keep(project.id, held, {
        runs,
        checkedAt: at,
        stale: false,
        problem: null,
        triedAt: at,
      });
    } catch (error) {
      const problem: CiRunProblem =
        error instanceof CodeHostRefused
          ? { kind: "cannot-read", text: error.message }
          : { kind: "unreachable", codeHost: host.name, failedAt: at };
      const raised = !sameProblem(kept.problem, problem);
      if (raised) {
        this.logger.warn(
          `${host.name} failed listing ${project.name}'s CI runs: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return this.keep(project.id, held, {
        ...kept,
        stale: true,
        // A host still failing keeps its first failure, so a long outage isn't news every round.
        problem: raised ? problem : kept.problem,
        triedAt: at,
      });
    }
  }

  /** Keeps the Project's listing; true when what Work › CI shows of it changed. */
  private keep(projectId: string, held: Listing | undefined, listing: Listing): boolean {
    this.listings.set(projectId, listing);
    if (held === undefined) return true;
    return (
      held.stale !== listing.stale ||
      !sameProblem(held.problem, listing.problem) ||
      !sameRuns(held.runs, listing.runs)
    );
  }

  /** Drops what is held of Projects removed since. */
  private forgetProjectsGone(projects: readonly Project[]): void {
    const ids = new Set(projects.map((project) => project.id));
    for (const projectId of this.listings.keys()) {
      if (!ids.has(projectId)) this.listings.delete(projectId);
    }
    for (const projectId of this.expecting.keys()) {
      if (!ids.has(projectId)) this.expecting.delete(projectId);
    }
  }

  /** The base branch's remote URL as git resolves it; undefined without one or when git fails. */
  private async remoteUrlOf(project: Project): Promise<string | undefined> {
    try {
      const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
      return upstream && (await this.git.fetchUrlOf(project.path, upstream.remote));
    } catch {
      // A Project whose folder is gone or broken has no CI runs to list; its page says why.
      return undefined;
    }
  }
}

function newestFirst(one: CiRun, other: CiRun): number {
  const at = (run: CiRun) => (run.startedAt ?? run.updatedAt).getTime();
  return at(other) - at(one) || other.id - one.id;
}

/** Two problems the same, a host failing since a different time being the same failure. */
function sameProblem(one: CiRunProblem | null, other: CiRunProblem | null): boolean {
  if (one === null || other === null) return one === other;
  if (one.kind === "cannot-read" && other.kind === "cannot-read") return one.text === other.text;
  return one.kind === other.kind;
}

function sameRuns(one: readonly CiRunOnHost[], other: readonly CiRunOnHost[]): boolean {
  return JSON.stringify(one.map(shownOf)) === JSON.stringify(other.map(shownOf));
}

/** What Work › CI shows of a run, comparable as JSON. */
function shownOf(run: CiRunOnHost): unknown {
  return {
    ...run,
    startedAt: run.startedAt?.getTime() ?? null,
    updatedAt: run.updatedAt.getTime(),
  };
}
