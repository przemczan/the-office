import { resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { NewProject, Project } from "../domain/project.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { ProjectChecks } from "./project-checks.js";
import { ProjectService } from "./project-service.js";
import { RepositoriesByUrl } from "./repositories-by-url.js";
import { NO_BRANCH_YET, RepositoryClones } from "./repository-clones.js";
import { clonePathOf, readRepositoryUrl } from "./repository-url.js";

/**
 * Adds a Project from its repository's folder, or from its Repository URL by cloning it first and
 * waiting for the clone (spec §2.1, §5.5 Defaults), as a Proposal of a Project to onboard is
 * applied. A Project by URL is judged with nothing cloned: its base branch from the remote's.
 */
@Injectable()
export class ProjectsFromRepositories {
  constructor(
    private readonly projects: ProjectService,
    private readonly checks: ProjectChecks,
    private readonly clones: RepositoryClones,
    private readonly repositoriesByUrl: RepositoriesByUrl,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /** The folder `url` is cloned into; refused for a URL The Office doesn't clone. */
  clonePathOf(url: string): string {
    const reading = readRepositoryUrl(url);
    if (reading.kind === "refused") throw new ProjectRefused([reading.problem]);
    return resolve(clonePathOf(this.officeData.folder("repositories"), reading.repositoryUrl));
  }

  /** Every reason `add` would refuse the Project now; empty when it can be added. */
  async newProjectProblems(project: NewProject): Promise<string[]> {
    const { repositoryUrl } = project;
    if (repositoryUrl === undefined) return this.projects.newProjectProblems(project);
    const problems = await this.checks.newCloneProblems(project);
    if (readRepositoryUrl(repositoryUrl).kind === "refused") return problems;
    return [...problems, ...(await this.remoteProblems(repositoryUrl, project.baseBranch))];
  }

  findByPath(path: string): Promise<Project | undefined> {
    return this.projects.findByPath(path);
  }

  /** A Project by URL is added once its clone is complete; a failed clone refuses it in git's words. */
  async add(project: NewProject): Promise<Project> {
    if (project.repositoryUrl === undefined) return this.projects.add(project);
    const clone = await this.clones.clone(project.repositoryUrl);
    if (clone.state === "failed") throw new ProjectRefused([clone.problem]);
    return this.projects.add({ ...project, path: clone.path });
  }

  private async remoteProblems(url: string, baseBranch: string): Promise<string[]> {
    try {
      const { defaultBranch, branches } = await this.repositoriesByUrl.remoteBranchesOf(url);
      if (defaultBranch === undefined) return [NO_BRANCH_YET];
      const branch = baseBranch.trim();
      return branch === "" || branches.includes(branch)
        ? []
        : [`The repository has no branch "${branch}".`];
    } catch (error) {
      if (error instanceof ProjectRefused) return [...error.reasons];
      throw error;
    }
  }
}
