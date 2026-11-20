import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { IssueLinkChanged } from "../domain/issue-link-events.js";
import type { Project } from "../domain/project.js";
import { IssueLinkRepository } from "../ports/issue-link-repository.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { IssueImport } from "./issue-import.js";
import { IssueWriteBacks } from "./issue-write-backs.js";
import { ProjectIssueHosts, type ProjectIssueHost } from "./project-issue-hosts.js";

export const ISSUE_WATCH = "issues";
/** How long the watch waits after each check. */
export const ISSUE_WATCH_EVERY = 5 * 60 * 1000;

/**
 * Every `ISSUE_WATCH_EVERY`, for each Project whose repository is on a code host, while The Office
 * is signed in to it with a token valid now (else the Project is passed over, saying nothing):
 * imports the open issues with the Project's auto-import label not yet linked (`IssueImport`),
 * reads the state of each issue whose Task hasn't ended and keeps when it closed on the host, or
 * clears it once opened again (the Task doesn't move), and tries again the write-backs the host
 * refused (`IssueWriteBacks.retry`). One check at a time.
 */
@Injectable()
export class IssueWatch implements OnApplicationBootstrap {
  private readonly logger = new Logger(IssueWatch.name);
  private running: Promise<void> | undefined;

  constructor(
    private readonly projects: ProjectRepository,
    private readonly hosts: ProjectIssueHosts,
    private readonly links: IssueLinkRepository,
    private readonly issueImport: IssueImport,
    private readonly writeBacks: IssueWriteBacks,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule.every(ISSUE_WATCH, ISSUE_WATCH_EVERY, () => this.check());
  }

  /** A check of every Project, or the one under way: never two at once. */
  check(): Promise<void> {
    this.running ??= this.round().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async round(): Promise<void> {
    for (const project of await this.projects.list()) {
      try {
        await this.checkProject(project);
      } catch (error) {
        this.logger.warn(
          `Checking the GitHub issues of ${project.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async checkProject(project: Project): Promise<void> {
    const onHost = await this.hosts.of(project);
    if (onHost === undefined) return;
    // Signed out, or the token can't be renewed now: nothing to ask, and nothing to say.
    if ((await onHost.host.whyCannotRead(onHost.remoteUrl)) !== undefined) return;
    await this.issueImport.importLabelled(project, onHost);
    await this.readStates(project, onHost);
    await this.writeBacks.retry(project.id);
  }

  /** Keeps when each watched issue closed on the host, or clears it once it is open again. */
  private async readStates(project: Project, { host }: ProjectIssueHost): Promise<void> {
    for (const link of await this.links.watched(project.id)) {
      const issue = await host.issue(link.remoteUrl, link.number);
      if (issue === undefined) continue;
      const closedOnHostAt = issue.state.state === "closed" ? issue.state.closedAt : null;
      await this.links.markChecked(link.id, closedOnHostAt, this.schedule.now());
      const changed = (link.closedOnHostAt === null) !== (closedOnHostAt === null);
      if (changed && link.taskId !== null) {
        await this.events.publish(new IssueLinkChanged(project.id, link.taskId));
      }
    }
  }
}
