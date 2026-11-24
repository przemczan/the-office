import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { IssueLinkChanged } from "../domain/issue-link-events.js";
import {
  doneComment,
  droppedComment,
  REOPENED_COMMENT,
  startedComment,
  type DuplicateOf,
  type IssueDoneIn,
  type IssueDropReason,
  type IssueLink,
  type IssueWriteBackAction,
  type IssueWriteBackEntry,
} from "../domain/issue-link.js";
import type { Project } from "../domain/project.js";
import { isFeatureOn } from "../domain/project-features.js";
import type { CodeHost } from "../ports/code-host.js";
import { IssueLinkRepository } from "../ports/issue-link-repository.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { PullRequestRepository } from "../ports/pull-request-repository.js";
import { CodeHosts } from "./code-hosts.js";
import { IssueWriteBack } from "./issue-write-back.js";
import { Worktrees } from "./worktrees.js";

/** How long a write-back the code host refused is tried again, on each check of the issue watch. */
export const WRITE_BACK_RETRIED_FOR = 24 * 60 * 60 * 1000;

/**
 * Writes back on the issue a Task was imported from, as its Project's switches say
 * (docs/design/issues-as-tasks.html): with "Comment on start and Done", a comment when the Task
 * starts and when it is Done ("Done in #12." for a pull request, "Done in 3f2c1ab." for a merge);
 * with "Close the issue when the Task is Dropped", a comment giving the drop reason, then a close
 * as not planned. Closing on Done is Publish's `Fixes #n`, not a write here. Done or Dropped stops
 * the watch of the issue. Every comment and close goes through the outbox (`issue_write_backs`)
 * and is tried at once, in order, a link's next one waiting for the one before; what the host
 * refused is tried again by `retry` for `WRITE_BACK_RETRIED_FOR`, its problem on the Task's issue
 * record meanwhile.
 */
@Injectable()
export class IssueWriteBacks extends IssueWriteBack {
  private readonly logger = new Logger(IssueWriteBacks.name);
  /** Each link's write-backs under way, so two flushes never send the same one twice. */
  private readonly flushing = new Map<string, Promise<void>>();

  constructor(
    private readonly links: IssueLinkRepository,
    private readonly projects: ProjectRepository,
    private readonly codeHosts: CodeHosts,
    private readonly pullRequests: PullRequestRepository,
    private readonly worktrees: Worktrees,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {
    super();
  }

  async taskStarted(taskId: string, title: string): Promise<void> {
    const found = await this.linked(taskId);
    if (!found || !writesBack(found.project, "commentOnStartAndDone")) return;
    await this.write(found.link, [["comment", startedComment(title)]]);
  }

  async taskDone(taskId: string): Promise<void> {
    const found = await this.linked(taskId);
    if (!found) return;
    await this.links.endTask(found.link.id, this.schedule.now());
    if (!writesBack(found.project, "commentOnStartAndDone")) return;
    const doneIn = await this.doneIn(found.project, taskId);
    await this.write(found.link, [["comment", doneComment(doneIn)]]);
  }

  async taskDropped(taskId: string, dropReason: IssueDropReason | null): Promise<void> {
    const found = await this.linked(taskId);
    if (!found) return;
    await this.links.endTask(found.link.id, this.schedule.now());
    if (!writesBack(found.project, "closeOnDrop")) return;
    const duplicateOf = await this.duplicateOf(found.link, dropReason);
    await this.write(found.link, [
      ["comment", droppedComment(dropReason, duplicateOf)],
      ["close", ""],
    ]);
  }

  /**
   * The Dropped Task was reopened: the watch reads its issue again, and an issue its Drop closed
   * (the link's latest close or reopen is a close) gets a comment and is opened again, whatever the
   * switches say now, as the close was The Office's own.
   */
  async taskReopened(taskId: string): Promise<void> {
    const found = await this.linked(taskId);
    if (!found) return;
    await this.links.reopenTask(found.link.id);
    const lastOpenOrClose = (await this.links.writeBacksOf(found.link.id))
      .filter(({ action }) => action !== "comment")
      .at(-1);
    if (lastOpenOrClose?.action !== "close") return;
    await this.write(found.link, [
      ["comment", REOPENED_COMMENT],
      ["reopen", ""],
    ]);
  }

  /**
   * Tries again the Project's write-backs the code host refused within `WRITE_BACK_RETRIED_FOR`,
   * each link's in order, as the issue watch's check does.
   */
  async retry(projectId: string): Promise<void> {
    const since = new Date(this.schedule.now().getTime() - WRITE_BACK_RETRIED_FOR);
    for (const link of await this.links.withPendingWriteBacks(projectId, since)) {
      await this.flush(link);
    }
  }

  /** The Task's link and its Project; undefined for a Task not imported from an issue. */
  private async linked(
    taskId: string,
  ): Promise<{ readonly link: IssueLink; readonly project: Project } | undefined> {
    const link = await this.links.ofTask(taskId);
    if (link === undefined) return undefined;
    const project = await this.projects.find(link.projectId);
    return project && { link, project };
  }

  /** Where the Done Task landed: the pull request it opened, else the commit its merge made. */
  private async doneIn(project: Project, taskId: string): Promise<IssueDoneIn> {
    const pullRequest = await this.pullRequests.ofTask(taskId);
    if (pullRequest) return { kind: "pull-request", number: pullRequest.number };
    const commit = await this.worktrees.landedOf(project, taskId).catch(() => undefined);
    return commit === undefined ? { kind: "unknown" } : { kind: "commit", commit };
  }

  /** A Duplicate's other Task: its issue in the same repository, else its title. */
  private async duplicateOf(
    link: IssueLink,
    dropReason: IssueDropReason | null,
  ): Promise<DuplicateOf | undefined> {
    if (dropReason?.kind !== "duplicate") return undefined;
    const other = await this.links.ofTask(dropReason.taskId);
    return other !== undefined && other.remoteUrl === link.remoteUrl
      ? { kind: "issue", number: other.number }
      : { kind: "task", title: dropReason.title };
  }

  /** Keeps the write-backs in the outbox, then tries them at once. */
  private async write(
    link: IssueLink,
    writes: readonly (readonly [IssueWriteBackAction, string])[],
  ): Promise<void> {
    const at = this.schedule.now().getTime();
    const entries: IssueWriteBackEntry[] = writes.map(([action, body], index) => ({
      id: randomUUID(),
      issueLinkId: link.id,
      action,
      body,
      // A millisecond apart, so the outbox keeps their order.
      createdAt: new Date(at + index),
      doneAt: null,
      tries: 0,
      lastProblem: null,
    }));
    await this.links.addWriteBacks(entries);
    await this.flush(link);
  }

  /** The link's write-backs not done, in order, after any flush of it under way. */
  private flush(link: IssueLink): Promise<void> {
    const before = this.flushing.get(link.id) ?? Promise.resolve();
    const flushed = before.then(() => this.send(link));
    // Kept settled whatever the send did: the caller has its failure, the next flush still runs,
    // and no rejection is left unhandled.
    const kept: Promise<void> = flushed
      .catch(() => undefined)
      .finally(() => {
        if (this.flushing.get(link.id) === kept) this.flushing.delete(link.id);
      });
    this.flushing.set(link.id, kept);
    return flushed;
  }

  /** Sends each write-back not done and not given up, stopping at the first the host refuses. */
  private async send(link: IssueLink): Promise<void> {
    const problemBefore = await this.links.writeBackProblemOf(link.id);
    const host = this.codeHosts.of(link.remoteUrl);
    // One refused for longer than it is retried is given up, and holds no later one back.
    const since = this.schedule.now().getTime() - WRITE_BACK_RETRIED_FOR;
    const pending = (await this.links.pendingWriteBacks(link.id)).filter(
      (entry) => entry.createdAt.getTime() >= since,
    );
    for (const entry of pending) {
      try {
        if (host === undefined) {
          throw new Error("The issue's repository isn't on a code host The Office knows.");
        }
        await sendWriteBack(host, link, entry);
        await this.links.writeBackDone(entry.id, this.schedule.now());
      } catch (error) {
        const problem = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Writing back on #${link.number} of ${link.remoteUrl} failed: ${problem}`);
        await this.links.writeBackFailed(entry.id, problem);
        break;
      }
    }
    const problemAfter = await this.links.writeBackProblemOf(link.id);
    if (problemAfter !== problemBefore && link.taskId !== null) {
      await this.events.publish(new IssueLinkChanged(link.projectId, link.taskId));
    }
  }
}

/**
 * Whether the Project's switch asks for the write-back. With its GitHub issues switched off none is
 * even kept in the outbox, so nothing reaches the issue once they are on again; the Task's end is
 * still kept on the link, which stays.
 */
function writesBack(project: Project, setting: "commentOnStartAndDone" | "closeOnDrop"): boolean {
  return isFeatureOn(project, "github-issues") && project.issueSettings[setting];
}

/** Does the write-back on the issue, by its action. */
async function sendWriteBack(
  host: CodeHost,
  link: IssueLink,
  entry: IssueWriteBackEntry,
): Promise<void> {
  switch (entry.action) {
    case "comment":
      return host.commentOnIssue(link.remoteUrl, link.number, entry.body);
    case "close":
      return host.closeIssue(link.remoteUrl, link.number);
    case "reopen":
      return host.reopenIssue(link.remoteUrl, link.number);
  }
}
