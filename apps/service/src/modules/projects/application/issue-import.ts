import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { IssuesImported } from "../domain/issue-link-events.js";
import { issueKindOf, type IssueImportedBy, type IssueLink } from "../domain/issue-link.js";
import { byTheUser, type ActedBy } from "../domain/acted-by.js";
import type { Project } from "../domain/project.js";
import { CodeHostRefused, type IssueOnHost } from "../ports/code-host.js";
import { IssueLinkRepository } from "../ports/issue-link-repository.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { isFeatureOn, ISSUES_FEATURE } from "../domain/project-features.js";
import { IssueTasks } from "./issue-tasks.js";
import { ensureFeatureOn } from "./project-features.js";
import { ProjectIssueHosts, type ProjectIssueHost } from "./project-issue-hosts.js";

/** The most open issues the Import issues window lists, newest first. */
export const OPEN_ISSUES_LISTED = 500;
/** The most issues imported by one request, or by one check of the auto-import. */
export const MOST_IMPORTED_AT_ONCE = 50;

/** An open issue not yet imported, with the Kind it would import as. */
export interface OpenIssue extends IssueOnHost {
  readonly kind: "bug" | "feature";
}

/** What an import made: the Tasks, by issue number, and the issues skipped with why. */
export interface IssueImportResult {
  readonly imported: readonly { readonly number: number; readonly taskId: string }[];
  readonly skipped: readonly { readonly number: number; readonly why: string }[];
}

/** One issue's import: its Task, or why there is none. */
type ImportOutcome =
  | { readonly kind: "imported"; readonly taskId: string }
  | { readonly kind: "skipped"; readonly why: string };

/** The issue a Task was imported from, as its record shows it. */
export interface IssueLinkRecord {
  readonly link: IssueLink;
  /** Why the newest write-back not done failed; null when none has. */
  readonly writeBackProblem: string | null;
}

/**
 * Importing a Project's issues as Tasks (docs/design/issues-as-tasks.html): each issue becomes a
 * Task in Backlog, its title the issue's, its body the Description, Bug with a `bug` label (any
 * case) else Feature, Normal priority. Import-once: the issue's link is claimed first, its remote
 * and number unique, so an issue already linked, by hand or by the auto-import, at once or long
 * ago, its Task Dropped or archived since, is skipped; a Task Work refuses gives the claim back.
 */
@Injectable()
export class IssueImport {
  private readonly logger = new Logger(IssueImport.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly hosts: ProjectIssueHosts,
    private readonly links: IssueLinkRepository,
    private readonly tasks: IssueTasks,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  /**
   * The Project's open issues not yet imported, newest first, up to `OPEN_ISSUES_LISTED` of them,
   * each with the Kind it would import as. Refused (ProjectRefused) when its repository isn't on a
   * code host or can't be read now, and `FeatureSwitchedOff` while its GitHub issues are off.
   */
  async openIssues(projectId: string): Promise<readonly OpenIssue[]> {
    const project = await this.project(projectId);
    const { remoteUrl, host } = await this.hosts.readable(project);
    const [issues, linked] = await Promise.all([
      refusing(host.openIssues(remoteUrl, { order: "newest-first", most: OPEN_ISSUES_LISTED })),
      this.links.linkedNumbers(remoteUrl),
    ]);
    return issues
      .filter((issue) => !linked.has(issue.number))
      .map((issue) => ({ ...issue, kind: issueKindOf(issue.labels) }));
  }

  /**
   * Imports the issues by number as Tasks created by `by`, in the order given, each once. An
   * issue the host doesn't have, a closed one, one already imported, or one whose Task Work
   * refuses is skipped, saying why. Refused as `openIssues` is.
   */
  async importByHand(
    projectId: string,
    numbers: readonly number[],
    by: ActedBy,
  ): Promise<IssueImportResult> {
    const project = await this.project(projectId);
    const onHost = await this.hosts.readable(project);
    const imported: { number: number; taskId: string }[] = [];
    const skipped: { number: number; why: string }[] = [];
    for (const number of new Set(numbers)) {
      const outcome = await this.importNumber(project, onHost, number, by);
      if (outcome.kind === "imported") imported.push({ number, taskId: outcome.taskId });
      else skipped.push({ number, why: outcome.why });
    }
    await this.announce(project.id, imported);
    return { imported, skipped };
  }

  /**
   * The auto-import of one check: the open issues with the Project's label not yet imported,
   * oldest first, at most `MOST_IMPORTED_AT_ONCE`, created by The Office in the name of who set
   * the label. Gives how many it imported.
   */
  async importLabelled(project: Project, { remoteUrl, host }: ProjectIssueHost): Promise<number> {
    // The watch passes such a Project over already; kept here too, so no caller imports past it.
    if (!isFeatureOn(project, ISSUES_FEATURE)) return 0;
    const { autoImportLabel, autoImportLabelSetBy } = project.issueSettings;
    if (autoImportLabel === null || autoImportLabelSetBy === null) return 0;
    const [issues, linked] = await Promise.all([
      host.openIssues(remoteUrl, {
        label: autoImportLabel,
        order: "oldest-first",
        most: OPEN_ISSUES_LISTED,
      }),
      this.links.linkedNumbers(remoteUrl),
    ]);
    const label = autoImportLabel.toLowerCase();
    const wanted = issues
      .filter((issue) => !linked.has(issue.number))
      .filter((issue) => issue.labels.some((each) => each.toLowerCase() === label))
      .slice(0, MOST_IMPORTED_AT_ONCE);
    const imported: { number: number; taskId: string }[] = [];
    for (const issue of wanted) {
      const outcome = await this.importIssue(project, remoteUrl, issue, {
        importedBy: { kind: "office" },
        createdBy: byTheUser(autoImportLabelSetBy),
        createdByTheOffice: true,
      });
      if (outcome.kind === "imported")
        imported.push({ number: issue.number, taskId: outcome.taskId });
      else this.logger.warn(`Auto-importing #${issue.number} of ${project.name}: ${outcome.why}`);
    }
    await this.announce(project.id, imported);
    return imported.length;
  }

  /** The issue the Task was imported from, with its write-back problem; undefined when none. */
  async linkOf(taskId: string): Promise<IssueLinkRecord | undefined> {
    const link = await this.links.ofTask(taskId);
    if (link === undefined) return undefined;
    return { link, writeBackProblem: await this.links.writeBackProblemOf(link.id) };
  }

  private async importNumber(
    project: Project,
    { remoteUrl, host }: ProjectIssueHost,
    number: number,
    by: ActedBy,
  ): Promise<ImportOutcome> {
    if ((await this.links.linkedNumbers(remoteUrl)).has(number)) return alreadyImported(number);
    let issue;
    try {
      issue = await host.issue(remoteUrl, number);
    } catch (error) {
      if (error instanceof CodeHostRefused) return { kind: "skipped", why: error.message };
      throw error;
    }
    if (issue === undefined) {
      return { kind: "skipped", why: `#${number} isn't an issue on ${host.name}.` };
    }
    if (issue.state.state === "closed") {
      return { kind: "skipped", why: `#${number} is closed.` };
    }
    return this.importIssue(project, remoteUrl, issue, {
      importedBy: by,
      createdBy: by,
      createdByTheOffice: false,
    });
  }

  /** Claims the issue's link, makes its Task, then names the Task on the link. */
  private async importIssue(
    project: Project,
    remoteUrl: string,
    issue: IssueOnHost,
    {
      importedBy,
      createdBy,
      createdByTheOffice,
    }: {
      readonly importedBy: IssueImportedBy;
      readonly createdBy: ActedBy;
      readonly createdByTheOffice: boolean;
    },
  ): Promise<ImportOutcome> {
    const link: IssueLink = {
      id: randomUUID(),
      projectId: project.id,
      remoteUrl,
      number: issue.number,
      taskId: null,
      title: issue.title,
      url: issue.url,
      author: issue.author,
      importedAt: this.schedule.now(),
      importedBy,
      closedOnHostAt: null,
      taskEndedAt: null,
      checkedAt: null,
    };
    if (!(await this.links.claim(link))) return alreadyImported(issue.number);
    let taskId: string;
    try {
      taskId = await this.tasks.create({
        projectId: project.id,
        title: issue.title,
        description: issue.body,
        kind: issueKindOf(issue.labels),
        createdBy,
        createdByTheOffice,
      });
    } catch (error) {
      // Given back, so a later import can try again.
      await this.links.release(link.id);
      return { kind: "skipped", why: error instanceof Error ? error.message : String(error) };
    }
    await this.links.attachTask(link.id, taskId);
    return { kind: "imported", taskId };
  }

  private async announce(
    projectId: string,
    imported: readonly { readonly number: number; readonly taskId: string }[],
  ): Promise<void> {
    if (imported.length > 0) await this.events.publish(new IssuesImported(projectId, imported));
  }

  /** The Project, refused while its GitHub issues are switched off. */
  private async project(projectId: string): Promise<Project> {
    const project = await this.projects.find(projectId);
    if (!project) throw new ProjectNotFound(projectId);
    ensureFeatureOn(project, ISSUES_FEATURE);
    return project;
  }
}

function alreadyImported(number: number): ImportOutcome {
  return { kind: "skipped", why: `#${number} was already imported.` };
}

/** The host's refusal as the Project's, in its words. */
async function refusing<Answer>(asked: Promise<Answer>): Promise<Answer> {
  try {
    return await asked;
  } catch (error) {
    if (error instanceof CodeHostRefused) throw new ProjectRefused([error.message]);
    throw error;
  }
}
