import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBases } from "./task-bases.js";
import { branchRefusal } from "./test-instance-checkouts.js";

/** The Run environment definition's folder in a repository. */
const DEFINITION_FOLDER = ".devcontainer";

const REMOVE_RETRIES = 5;

/** The base branch tip's `.devcontainer/`, written out for a pairing environment. */
export interface ExportedDefinition {
  /** A temporary folder holding the base branch tip's `.devcontainer/` and nothing else. */
  readonly folder: string;
  /** Removes the folder; never throws. */
  remove(): Promise<void>;
}

/**
 * The definition a Project device's pairing environment is made from (spec §5.5, "A pairing
 * environment"): the base branch fetched as a test instance's checkout fetches its branch, then the
 * `.devcontainer/` of its tip alone written into a temporary folder, with no `.git` and no other
 * file of the repository.
 */
@Injectable()
export class PairingDefinitionExports {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly taskBases: TaskBases,
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
  ) {}

  /** Refused (ProjectRefused) in words when the base branch can't be fetched or has no `.devcontainer/`. */
  async exportDefinition(projectId: string): Promise<ExportedDefinition> {
    const project = await this.projects.find(projectId);
    if (!project) throw new ProjectNotFound(projectId);
    const branch = project.baseBranch;
    const variables = this.commands.variablesFor(project.environment);
    const commit = await this.git
      .exclusively(project.path, () => this.taskBases.freshBranchTip(project, branch, variables))
      .catch((error: unknown) => {
        throw branchRefusal(error, `Fetching ${branch} of ${project.name} failed.`);
      });
    const folder = await mkdtemp(join(tmpdir(), "office-pairing-definition-"));
    const remove = (): Promise<void> =>
      rm(folder, { recursive: true, force: true, maxRetries: REMOVE_RETRIES }).catch(
        () => undefined,
      );
    try {
      await this.git.exportCommit(project.path, commit, folder, variables, DEFINITION_FOLDER);
    } catch (error) {
      await remove();
      throw branchRefusal(
        error,
        `Reading ${DEFINITION_FOLDER}/ of ${branch} of ${project.name} failed.`,
      );
    }
    if ((await readdir(folder)).length === 0) {
      await remove();
      throw new ProjectRefused([
        `${branch} of ${project.name} has no ${DEFINITION_FOLDER}/ folder at ${commit.slice(0, 7)}.`,
      ]);
    }
    return { folder, remove };
  }
}
