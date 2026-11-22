import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ProjectDeleteMergedBranchesChanged, PullRequestMerged } from "../../projects/index.js";
import type { Author } from "../domain/author.js";
import {
  BY_DELETE_MERGED_BRANCHES,
  initiativeBranchDeletionRefusal,
  initiativeBranchOfTask,
  recordInitiativeBranchDeletion,
  recordTaskBranchDeletion,
  shortNameOfBranch,
  taskBranchDeletionRefusal,
  taskBranchOf,
  taskIdOfBranch,
  type BranchDeletedBy,
} from "../domain/branch-deletion.js";
import type { Initiative } from "../domain/initiative.js";
import { InitiativeStateChanged } from "../domain/initiative-events.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { lastPublishedBy } from "../domain/publishing-task.js";
import { initiativeBranchOf } from "../domain/short-name.js";
import { isPublishingTask, type Task } from "../domain/task.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { TaskRefused } from "../domain/task-refused.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import {
  ProjectBranchDeletions,
  type BranchDeletion,
  type BranchDeletionPreview,
  type BranchDeletionRequest,
  type BranchOwner,
} from "../ports/project-branch-deletions.js";
import { TaskRepository } from "../ports/task-repository.js";

/** The sweep's name in the logs. */
export const BRANCH_CLEANUP = "branch cleanup";

/** How long the sweep waits after each run (spec 5.5, "Deleting merged branches"). */
export const BRANCH_CLEANUP_EVERY_MS = 60 * 60 * 1000;

/** A branch of a Task or an Initiative, and whether the repository knows it, without fetching. */
export interface KnownBranch {
  readonly projectId: string;
  readonly branch: string;
  readonly known: boolean;
}

/** A branch Work can judge: where it is, whose it is, and Work's own refusal, if any. */
interface OwnedBranch {
  readonly projectId: string;
  readonly branch: string;
  readonly owner: BranchOwner;
  readonly refusal: string | undefined;
  /** Whether Delete branches once merged may take it: its Task or Initiative is Done. */
  readonly done: boolean;
  readonly record: (
    by: BranchDeletedBy,
    deletion: Extract<BranchDeletion, { kind: "deleted" }>,
  ) => Promise<void>;
}

/**
 * Deleting the branches of merged Tasks and Initiatives (spec 5.5, "Deleting merged branches"): by
 * hand from the Task and Initiative pages, judged by the Projects module against the freshly
 * fetched base, and, while a Project's Delete branches once merged is On, by The Office once a
 * Task or an Initiative is Done, its pull request merges, or the sweep finds a leftover. The
 * automatic cleanup takes only a Done one's branch holding nothing the base lacks; what it leaves
 * is logged, never recorded. Git runs in the background of the events, never in a database hold.
 */
@Injectable()
export class BranchCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BranchCleanup.name);
  private readonly running = new Set<Promise<void>>();
  private readonly sweeping = new Set<string>();

  constructor(
    private readonly tasks: TaskRepository,
    private readonly initiatives: InitiativeRepository,
    private readonly deletions: ProjectBranchDeletions,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, ({ taskId, to }) => {
      if (to === "done") this.inBackground(() => this.cleanTask(taskId));
    });
    this.events.subscribe(InitiativeStateChanged, ({ initiativeId, to }) => {
      if (to === "done") this.inBackground(() => this.cleanInitiative(initiativeId));
    });
    this.events.subscribe(PullRequestMerged, ({ taskId }) => {
      this.inBackground(() => this.cleanAfterPullRequest(taskId));
    });
    this.events.subscribe(ProjectDeleteMergedBranchesChanged, ({ projectId, on }) => {
      if (on) this.inBackground(() => this.sweep(projectId));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.idle();
  }

  /** Sweeps now, as the service starts, then every hour. Started only by the service's own start. */
  start(): void {
    this.schedule.every(BRANCH_CLEANUP, BRANCH_CLEANUP_EVERY_MS, () => this.sweepAll());
  }

  /** Waits until the cleanups the events started have ended. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running);
  }

  /** The Task's own branch, known or not; null for a Task that holds none. */
  async branchOf(taskId: string): Promise<KnownBranch | null> {
    const task = await this.taskOf(taskId);
    const branch = taskBranchOf(task);
    if (branch === undefined) return null;
    return { projectId: task.projectId, branch, known: await this.isKnown(task.projectId, branch) };
  }

  /** The Initiative's branch in each Project it was made in, known or not. */
  async branchesOf(initiativeId: string): Promise<readonly KnownBranch[]> {
    const initiative = await this.initiativeOf(initiativeId);
    const { shortName } = initiative;
    if (shortName === undefined) return [];
    const branch = initiativeBranchOf(shortName);
    return Promise.all(
      initiative.branches.map(async ({ projectId }) => ({
        projectId,
        branch,
        known: await this.isKnown(projectId, branch),
      })),
    );
  }

  /** What Delete branch… on the Task would delete, Work's refusal first. */
  async previewOfTask(taskId: string): Promise<BranchDeletionPreview> {
    return this.preview(await this.ownedByTask(await this.taskOf(taskId)));
  }

  /** Deletes the Task's branch by hand, as `request` judged it. */
  async deleteOfTask(
    taskId: string,
    request: BranchDeletionRequest,
    by: Author,
  ): Promise<BranchDeletion> {
    return this.deleteByHand(await this.ownedByTask(await this.taskOf(taskId)), request, by);
  }

  /** What Delete branch… on the Initiative would delete in the Project, Work's refusal first. */
  async previewOfInitiative(
    initiativeId: string,
    projectId: string,
  ): Promise<BranchDeletionPreview> {
    return this.preview(
      await this.ownedByInitiative(await this.initiativeOf(initiativeId), projectId),
    );
  }

  /** Deletes the Initiative's branch in the Project by hand, as `request` judged it. */
  async deleteOfInitiative(
    initiativeId: string,
    projectId: string,
    request: BranchDeletionRequest,
    by: Author,
  ): Promise<BranchDeletion> {
    const owned = await this.ownedByInitiative(await this.initiativeOf(initiativeId), projectId);
    return this.deleteByHand(owned, request, by);
  }

  /** One sweep of every Project whose Delete branches once merged is On. */
  async sweepAll(): Promise<void> {
    for (const projectId of await this.deletions.projectsDeletingMergedBranches()) {
      await this.sweep(projectId);
    }
  }

  /**
   * One sweep of the Project: each `office/*` and `initiative/*` branch it knows, of a Task or an
   * Initiative The Office knows there, cleaned when safe, each tried once; others are never touched.
   */
  async sweep(projectId: string): Promise<void> {
    if (this.sweeping.has(projectId)) return;
    this.sweeping.add(projectId);
    try {
      const branches = await this.deletions.knownBranches(projectId);
      const initiatives = branches.some((branch) => shortNameOfBranch(branch) !== undefined)
        ? await this.initiatives.list()
        : [];
      for (const branch of branches) {
        const owned = await this.ownedOfBranch(projectId, branch, initiatives);
        if (owned) await this.cleanOwned(owned);
      }
    } finally {
      this.sweeping.delete(projectId);
    }
  }

  private async cleanTask(taskId: string): Promise<void> {
    const task = await this.tasks.find(taskId);
    if (!task || taskBranchOf(task) === undefined) return;
    await this.cleanOwned(await this.ownedByTask(task));
  }

  private async cleanInitiative(initiativeId: string): Promise<void> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) return;
    for (const { projectId, deletion } of initiative.branches) {
      if (!deletion) await this.cleanInitiativeIn(initiative, projectId);
    }
  }

  private async cleanInitiativeIn(initiative: Initiative, projectId: string): Promise<void> {
    if (initiative.shortName === undefined) return;
    await this.cleanOwned(await this.ownedByInitiative(initiative, projectId));
  }

  /** A merged pull request: its Task's branch, or a Publishing Task's Initiative's once it is Done. */
  private async cleanAfterPullRequest(taskId: string): Promise<void> {
    const task = await this.tasks.find(taskId);
    if (!task) return;
    if (!isPublishingTask(task)) {
      await this.cleanTask(taskId);
      return;
    }
    if (task.initiativeId === undefined) return;
    const initiative = await this.initiatives.find(task.initiativeId);
    if (initiative?.state === "done") await this.cleanInitiativeIn(initiative, task.projectId);
  }

  /** Delete branches once merged: only a Done one's, safe, with the setting On; the rest is logged. */
  private async cleanOwned(owned: OwnedBranch): Promise<void> {
    const { projectId, branch } = owned;
    if (!owned.done || owned.refusal !== undefined) return;
    if (!(await this.deletions.deletesMergedBranches(projectId))) return;
    if (!(await this.isKnown(projectId, branch))) return;
    const preview = await this.deletions.judge(projectId, branch, owned.owner);
    if (preview.refusal !== null || preview.holdsWork !== null) {
      this.logger.log(
        `The branch ${branch} in ${projectId} stays: ${preview.refusal ?? `it holds ${preview.holdsWork?.commitCount ?? 0} commits ${preview.baseBranch} doesn't have.`}`,
      );
      return;
    }
    const deletion = await this.deletions.delete(projectId, branch, owned.owner, {
      expected: preview.copies.map(({ kind, commit }) => ({ kind, commit })),
      deleteUnmerged: false,
    });
    if (deletion.kind === "refused") {
      this.logger.log(`The branch ${branch} in ${projectId} stays: ${deletion.reason}`);
      return;
    }
    await owned.record(BY_DELETE_MERGED_BRANCHES, deletion);
  }

  private async preview(owned: OwnedBranch): Promise<BranchDeletionPreview> {
    const preview = await this.deletions.judge(owned.projectId, owned.branch, owned.owner);
    return owned.refusal === undefined ? preview : { ...preview, refusal: owned.refusal };
  }

  private async deleteByHand(
    owned: OwnedBranch,
    request: BranchDeletionRequest,
    by: Author,
  ): Promise<BranchDeletion> {
    if (owned.refusal !== undefined) return { kind: "refused", reason: owned.refusal };
    const deletion = await this.deletions.delete(
      owned.projectId,
      owned.branch,
      owned.owner,
      request,
    );
    if (deletion.kind === "deleted") await owned.record(by, deletion);
    return deletion;
  }

  private async ownedOfBranch(
    projectId: string,
    branch: string,
    initiatives: readonly Initiative[],
  ): Promise<OwnedBranch | undefined> {
    const taskId = taskIdOfBranch(branch);
    if (taskId !== undefined) {
      const task = await this.tasks.find(taskId);
      if (!task || task.projectId !== projectId || taskBranchOf(task) !== branch) return undefined;
      return this.ownedByTask(task);
    }
    const shortName = shortNameOfBranch(branch);
    const initiative = initiatives.find(
      (candidate) =>
        candidate.shortName === shortName &&
        candidate.branches.some((made) => made.projectId === projectId),
    );
    return initiative ? this.ownedByInitiative(initiative, projectId) : undefined;
  }

  private async ownedByTask(task: Task): Promise<OwnedBranch> {
    const branch = taskBranchOf(task);
    if (branch === undefined) throw new TaskRefused(["The Task holds no branch of its own."]);
    const initiative =
      task.initiativeId === undefined ? undefined : await this.initiatives.find(task.initiativeId);
    const initiativeBranch = initiativeBranchOfTask(task, initiative);
    return {
      projectId: task.projectId,
      branch,
      owner: {
        kind: "task",
        taskId: task.id,
        ...(initiativeBranch === undefined ? {} : { initiativeBranch }),
      },
      refusal: taskBranchDeletionRefusal(task),
      done: task.state === "done",
      record: async (by, { copies }) => {
        const deletion = {
          branch,
          copies: copies.map(({ kind, name }) => ({ kind, name })),
          by,
          at: this.schedule.now(),
        };
        const { event } = await this.tasks.update(task.id, (held) =>
          recordTaskBranchDeletion(held, deletion),
        );
        if (event) await this.events.publish(event);
      },
    };
  }

  private async ownedByInitiative(initiative: Initiative, projectId: string): Promise<OwnedBranch> {
    const { shortName } = initiative;
    if (
      shortName === undefined ||
      !initiative.branches.some((made) => made.projectId === projectId)
    ) {
      throw new InitiativeRefused([`The Initiative has no branch in the Project ${projectId}.`]);
    }
    const branch = initiativeBranchOf(shortName);
    const tasks = (await this.tasks.inInitiatives([initiative.id])).filter(
      (task) => task.projectId === projectId,
    );
    const publishingTask = lastPublishedBy(tasks, projectId);
    return {
      projectId,
      branch,
      owner: {
        kind: "initiative",
        ...(publishingTask === undefined ? {} : { publishingTaskId: publishingTask.id }),
        tasks: tasks
          .filter((task) => !isPublishingTask(task))
          .map(({ id, title }) => ({ taskId: id, title })),
      },
      refusal: initiativeBranchDeletionRefusal(initiative, tasks, projectId),
      done: initiative.state === "done",
      record: async (by, { copies }) => {
        const deletion = {
          branch,
          copies: copies.map(({ kind, name }) => ({ kind, name })),
          by,
          at: this.schedule.now(),
        };
        const { event } = await this.initiatives.update(initiative.id, (held) =>
          recordInitiativeBranchDeletion(held, projectId, deletion),
        );
        if (event) await this.events.publish(event);
      },
    };
  }

  private async taskOf(taskId: string): Promise<Task> {
    const task = await this.tasks.find(taskId);
    if (!task) throw new TaskNotFound(taskId);
    return task;
  }

  private async initiativeOf(initiativeId: string): Promise<Initiative> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) throw new InitiativeNotFound(initiativeId);
    return initiative;
  }

  private isKnown(projectId: string, branch: string): Promise<boolean> {
    return this.deletions.isKnown(projectId, branch);
  }

  private inBackground(work: () => Promise<void>): void {
    const running = work().catch((error: unknown) => {
      this.logger.error(
        "A branch cleanup failed",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    });
    this.running.add(running);
    void running.finally(() => this.running.delete(running));
  }
}
