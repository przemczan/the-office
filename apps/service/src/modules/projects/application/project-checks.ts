import { isAbsolute } from "node:path";
import { Injectable } from "@nestjs/common";
import { newProjectProblems, trimmedNewProject, type NewProject } from "../domain/project.js";
import { environmentProblems, type ProjectEnvironment } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git, type FolderInspection } from "../ports/git.js";
import { KnownPipelines } from "../ports/known-pipelines.js";

/** The rules of a Project that need git or the Pipelines, next to the domain's own. */
@Injectable()
export class ProjectChecks {
  constructor(
    private readonly git: Git,
    private readonly pipelines: KnownPipelines,
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
      ...(await this.repositoryProblems(newProject.path, newProject.baseBranch)),
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

  private async repositoryProblems(path: string, baseBranch: string): Promise<string[]> {
    if (path === "") return [];
    if (!isAbsolute(path)) return ["Give the repository's full path, not a relative one."];
    const inspection = await this.git.inspect(path);
    if (inspection.kind !== "repository") return [folderProblem(path, inspection)];
    if (baseBranch === "" || (await this.git.hasBranch(path, baseBranch))) return [];
    return [`The repository has no branch "${baseBranch}".`];
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
