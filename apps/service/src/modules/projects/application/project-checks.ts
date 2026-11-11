import { isAbsolute, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { EngineModels, offeredModels, type EngineModel } from "../../engine/index.js";
import {
  missingPipelineCommandsProblems,
  namedByDefaultPipelineProblems,
} from "../domain/pipeline-commands.js";
import {
  newProjectProblems,
  trimmedNewProject,
  type NewProject,
  type Project,
} from "../domain/project.js";
import { environmentProblems, type ProjectEnvironment } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { CLONE_REMOTE, Git, type FolderInspection } from "../ports/git.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { clonePathOf, readRepositoryUrl } from "./repository-url.js";

/** The rules of a Project that need git, the Pipelines or the engines, next to the domain's own. */
@Injectable()
export class ProjectChecks {
  constructor(
    private readonly git: Git,
    private readonly pipelines: KnownPipelines,
    private readonly officeData: OfficeDataDirectory,
    private readonly engines: EngineModels,
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
      ...(await this.pipelineProblems(newProject)),
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
      ...(await this.pipelineProblems(newProject)),
    ];
  }

  /** Refuses a Pipeline the library lacks, or one running a command the Project lacks. */
  async checkDefaultPipeline(
    project: Pick<Project, "defaultPipeline" | "commands" | "name">,
  ): Promise<void> {
    const problems = await this.pipelineProblems(project);
    if (problems.length > 0) throw new ProjectRefused(problems);
  }

  /** Refuses removing a command the Project's default Pipeline runs. */
  async checkCommandRemoval(project: Pick<Project, "defaultPipeline">, key: string): Promise<void> {
    const problems = await this.commandRemovalProblems(project, [key]);
    if (problems.length > 0) throw new ProjectRefused(problems);
  }

  /**
   * Why the commands can't be removed: the Project's default Pipeline runs one, so the default
   * stays runnable in its Project. Another Pipeline's Stage fails as could-not-run instead.
   */
  async commandRemovalProblems(
    { defaultPipeline }: Pick<Project, "defaultPipeline">,
    keys: readonly string[],
  ): Promise<string[]> {
    if (keys.length === 0) return [];
    const pipeline = await this.pipelines.commandsNamedBy(defaultPipeline);
    return keys.flatMap((key) => namedByDefaultPipelineProblems(key, pipeline));
  }

  /** Refuses an engine Settings › Engines doesn't list, or a model it doesn't offer. */
  async checkEngineModel({ engineId, model }: EngineModel): Promise<void> {
    const engine = await this.engines.find(engineId);
    if (engine === undefined) throw new ProjectRefused([`There is no engine "${engineId}".`]);
    if (!offeredModels(engine).includes(model)) {
      throw new ProjectRefused(["Choose a model the engine offers."]);
    }
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

  /** The Pipeline is in the library, and the Project has every command it runs. */
  private async pipelineProblems({
    defaultPipeline,
    commands,
    name,
  }: Pick<NewProject, "defaultPipeline" | "commands" | "name">): Promise<string[]> {
    const pipeline = await this.pipelines.commandsNamedBy(defaultPipeline);
    if (!pipeline) return [`There is no Pipeline "${defaultPipeline}".`];
    return missingPipelineCommandsProblems(pipeline, commands, name);
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
