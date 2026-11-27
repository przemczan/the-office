import { isAbsolute, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { EngineModels, engineTypeOffersOf, type EngineTypeOffers } from "../../engine/index.js";
import {
  defaultPipelineOwnerProblems,
  missingPipelineCommandsProblems,
  namedByDefaultPipelineProblems,
} from "../domain/pipeline-commands.js";
import {
  TASK_KINDS,
  type KindDefaultPipelines,
  type TaskKind,
} from "../domain/kind-default-pipeline.js";
import {
  newProjectProblems,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectEngine,
} from "../domain/project.js";
import { projectEngineProblems } from "../domain/project-engine.js";
import { environmentProblems, type ProjectEnvironment } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { CLONE_REMOTE, Git, type FolderInspection } from "../ports/git.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { clonePathOf, readRepositoryUrl } from "./repository-url.js";

/** The rules of a Project that need git, the Pipelines or the engines, next to the domain's own. */
@Injectable()
export class ProjectChecks {
  constructor(
    private readonly git: Git,
    private readonly pipelines: KnownPipelines,
    private readonly officeData: OfficeDataDirectory,
    private readonly engines: EngineModels,
    private readonly projects: ProjectRepository,
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
      ...(await this.pipelineProblems(newProject, undefined)),
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
      ...(await this.pipelineProblems(newProject, undefined)),
    ];
  }

  /**
   * Refuses a Pipeline neither the library nor the Project has, another Project's Project
   * Pipeline, a Broken one, or one whose Stages, built, run a command the Project lacks.
   */
  async checkDefaultPipeline(
    project: Pick<Project, "id" | "defaultPipeline" | "commands" | "name">,
  ): Promise<void> {
    const problems = await this.pipelineProblems(project, project.id);
    if (problems.length > 0) throw new ProjectRefused(problems);
  }

  /**
   * Why the commands can't be removed: the Project's default Pipeline, or a Kind's own default
   * Pipeline, runs one, a Project Pipeline of its own by its Stages, so each default stays
   * runnable in its Project. Another Pipeline's Stage fails as could-not-run instead.
   */
  async commandRemovalProblems(
    {
      id,
      defaultPipeline,
      kindDefaultPipelines,
    }: Pick<Project, "id" | "defaultPipeline" | "kindDefaultPipelines">,
    keys: readonly string[],
  ): Promise<string[]> {
    if (keys.length === 0) return [];
    const defaults = projectDefaults(defaultPipeline, kindDefaultPipelines);
    const problems = await Promise.all(
      [...defaults].map(async ([pipelineId, kinds]) => {
        const pipeline = await this.pipelines.commandsNamedBy(pipelineId);
        const ownDefault = pipeline?.projectId === undefined || pipeline.projectId === id;
        return ownDefault
          ? keys.flatMap((key) => namedByDefaultPipelineProblems(key, pipeline, kinds))
          : [];
      }),
    );
    return problems.flat();
  }

  /** What each engine type offers among the engines Settings › Engines lists now. */
  async engineTypeOffers(): Promise<EngineTypeOffers> {
    return engineTypeOffersOf(await this.engines.engines());
  }

  /**
   * Refuses the Project's engine levels `after` with every reason they can't run on the engines
   * listed now (`projectEngineProblems`), what `before` already has passing.
   */
  async checkProjectEngine(after: ProjectEngine, before: ProjectEngine): Promise<void> {
    const problems = projectEngineProblems(after, before, await this.engines.engines());
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
    if (baseBranch === "") return [];
    // An empty repository's base branch is made with its first commit as it is added.
    if (!(await this.git.hasCommits(path))) return this.newBaseBranchProblems(baseBranch);
    if (await this.hasBaseBranch(newProject)) return [];
    return [`The repository has no branch "${baseBranch}".`];
  }

  /** Why `baseBranch`, to be made in a repository without commits, can't be a branch's name. */
  async newBaseBranchProblems(baseBranch: string): Promise<string[]> {
    return (await this.git.isBranchName(baseBranch))
      ? []
      : [`"${baseBranch}" can't be a branch's name in git.`];
  }

  /** A clone's base branch may still be only the remote's, made locally as the Project is added. */
  private async hasBaseBranch({ path, baseBranch, repositoryUrl }: NewProject): Promise<boolean> {
    if (await this.git.hasBranch(path, baseBranch)) return true;
    return (
      repositoryUrl !== undefined &&
      this.git.hasRemoteBranch(path, { remote: CLONE_REMOTE, branch: baseBranch })
    );
  }

  /**
   * The Pipeline is office-wide or the Project's own and not Broken (a new Project, with no id,
   * takes an office-wide one only), and the Project has every command it runs.
   */
  private async pipelineProblems(
    { defaultPipeline, commands, name }: Pick<NewProject, "defaultPipeline" | "commands" | "name">,
    projectId: string | undefined,
  ): Promise<string[]> {
    const pipeline = await this.pipelines.commandsNamedBy(defaultPipeline);
    if (!pipeline) return [`There is no Pipeline "${defaultPipeline}".`];
    const ownerProblems = defaultPipelineOwnerProblems(
      pipeline,
      projectId,
      await this.ownerName(pipeline.projectId, name),
    );
    if (ownerProblems.length > 0) return ownerProblems;
    return missingPipelineCommandsProblems(pipeline, commands, name);
  }

  /** The name of the Project a Project Pipeline belongs to. */
  private async ownerName(ownerId: string | undefined, projectName: string): Promise<string> {
    if (ownerId === undefined) return projectName;
    return (await this.projects.find(ownerId))?.name ?? ownerId;
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

/**
 * The Project's default Pipelines, each with the Kinds it is the own default of; "all" for the
 * Project's default Pipeline, which a Kind that names it again adds nothing to.
 */
function projectDefaults(
  defaultPipeline: string,
  kindDefaultPipelines: KindDefaultPipelines,
): Map<string, "all" | TaskKind[]> {
  const defaults = new Map<string, "all" | TaskKind[]>([[defaultPipeline, "all"]]);
  for (const kind of TASK_KINDS) {
    const pipelineId = kindDefaultPipelines[kind];
    if (pipelineId === null) continue;
    const kinds = defaults.get(pipelineId) ?? [];
    if (kinds !== "all") defaults.set(pipelineId, [...kinds, kind]);
  }
  return defaults;
}
