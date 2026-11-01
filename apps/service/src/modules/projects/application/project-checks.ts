import { isAbsolute, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { newProjectProblems, trimmedNewProject, type NewProject } from "../domain/project.js";
import { environmentProblems, type ProjectEnvironment } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { CLONE_REMOTE, Git, type FolderInspection } from "../ports/git.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { clonePathOf, readRepositoryUrl } from "./repository-url.js";

/** The rules of a Project that need git or the Pipelines, next to the domain's own. */
@Injectable()
export class ProjectChecks {
  constructor(
    private readonly git: Git,
    private readonly pipelines: KnownPipelines,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /** Refuses with every reason the Project can't be added, before anything is saved. */
  async checkNewProject(given: NewProject): Promise<void> {
    const problems = await this.newProjectProblems(given);
    if (problems.length > 0) throw new ProjectRefused(problems);
  }

  /** Every reason the Project can't be added; empty when it can. */
  async newProjectProblems(given: NewProject): Promise<string[]> {
    const newProject = trimmedNewProject(given);
    return [
      ...newProjectProblems(newProject),
      ...this.repositoryUrlProblems(newProject),
      ...(await this.repositoryProblems(newProject)),
      ...(await this.pipelineProblems(newProject.defaultPipeline)),
    ];
  }

  /**
   * Every reason a Project by Repository URL can't be added but those of its clone's folder,
   * which isn't there before it is cloned; its branches are the remote's to answer.
   */
  async newCloneProblems(given: NewProject): Promise<string[]> {
    const newProject = trimmedNewProject(given);
    return [
      ...newProjectProblems(newProject),
      ...this.repositoryUrlProblems(newProject),
      ...(await this.pipelineProblems(newProject.defaultPipeline)),
    ];
  }

  async checkDefaultPipeline(pipelineId: string): Promise<void> {
    const problems = await this.pipelineProblems(pipelineId);
    if (problems.length > 0) throw new ProjectRefused(problems);
  }

  /**
   * Why an environment, as trimmedEnvironment keeps it, can't be tried: the domain's reasons,
   * and folders for PATH that aren't full paths on this system.
   */
  environmentProblems(environment: ProjectEnvironment): string[] {
    return [
      ...environmentProblems(environment),
      ...environment.prependPath
        .filter((folder) => !isAbsolute(folder))
        .map((folder) => `A folder put in front of PATH is a full path; "${folder}" is not.`),
    ];
  }

  /** Why `path` isn't a repository's top-level folder given in full; undefined when it is. */
  async repositoryFolderProblem(path: string): Promise<string | undefined> {
    if (!isAbsolute(path)) return "Give the repository's full path, not a relative one.";
    const inspection = await this.git.inspect(path);
    return inspection.kind === "repository" ? undefined : folderProblem(path, inspection);
  }

  /** A Repository URL is given only with its clone's folder as the path. */
  private repositoryUrlProblems({ repositoryUrl, path }: NewProject): string[] {
    if (repositoryUrl === undefined) return [];
    const reading = readRepositoryUrl(repositoryUrl);
    if (reading.kind === "refused") return [reading.problem];
    const clonePath = resolve(
      clonePathOf(this.officeData.folder("repositories"), reading.repositoryUrl),
    );
    return path === clonePath
      ? []
      : [`The clone of ${repositoryUrl} is at ${clonePath}, not ${path}.`];
  }

  private async repositoryProblems(newProject: NewProject): Promise<string[]> {
    const { path, baseBranch } = newProject;
    if (path === "") return [];
    const problem = await this.repositoryFolderProblem(path);
    if (problem !== undefined) return [problem];
    if (baseBranch === "" || (await this.hasBaseBranch(newProject))) return [];
    return [`The repository has no branch "${baseBranch}".`];
  }

  /** A clone's base branch may still be only the remote's, made locally as the Project is added. */
  private async hasBaseBranch({ path, baseBranch, repositoryUrl }: NewProject): Promise<boolean> {
    if (await this.git.hasBranch(path, baseBranch)) return true;
    return (
      repositoryUrl !== undefined &&
      this.git.hasRemoteBranch(path, { remote: CLONE_REMOTE, branch: baseBranch })
    );
  }

  private async pipelineProblems(pipelineId: string): Promise<string[]> {
    return (await this.pipelines.has(pipelineId)) ? [] : [`There is no Pipeline "${pipelineId}".`];
  }
}

function folderProblem(
  path: string,
  inspection: Exclude<FolderInspection, { kind: "repository" }>,
): string {
  switch (inspection.kind) {
    case "missing":
      return `There is no folder at ${path}.`;
    case "not-a-folder":
      return `${path} is a file, not a folder.`;
    case "not-a-repository":
      return `${path} is not a git repository: ${inspection.detail}`;
    case "inside-a-repository":
      return `${path} is inside the repository at ${inspection.root}; add that folder instead.`;
  }
}
