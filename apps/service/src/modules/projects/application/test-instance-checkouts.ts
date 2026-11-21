import { rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { Project } from "../domain/project.js";
import { ExistingBranchUnusable } from "../domain/task-base.js";
import { Git, GitCommandFailed } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBases } from "./task-bases.js";
import { runEnvironmentInstallOf, type RunEnvironmentInstall } from "./task-run-environments.js";

const REMOVE_RETRIES = 5;

/**
 * A test instance's own checkout of an Initiative's branch in a Project (spec §5.5, "A test
 * instance's checkout"): the branch fetched from the base branch's remote first, then the files of
 * its tip written into `<office-data>/test-instances/<id>/` with no `.git` at all, so nothing in it
 * leads back to the repository, its remotes or the Office identity, and no git folder is mounted
 * with it. Never a linked worktree, whose `.git` file points into the repository.
 */
@Injectable()
export class TestInstanceCheckouts {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly taskBases: TaskBases,
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /**
   * Makes `folder`, one directly inside `<office-data>/test-instances/`, a checkout of the tip of
   * the Initiative's branch `branch`, fetched first, replacing anything it held, and answers the
   * commit. Refused (ProjectRefused) when the branch is gone or has diverged from its remote's,
   * when git fails, or for a folder elsewhere; a failed checkout leaves no folder.
   */
  async checkOut(projectId: string, branch: string, folder: string): Promise<{ commit: string }> {
    this.ensureTestInstanceFolder(folder);
    const project = await this.projectOf(projectId);
    const variables = this.commands.variablesFor(project.environment);
    const { commit } = await this.git
      .exclusively(project.path, () =>
        this.taskBases.freshInitiativeBranch(project, branch, variables),
      )
      .catch((error: unknown) => {
        throw refusal(error, `Fetching ${branch} of ${project.name} failed.`);
      });
    await this.remove(folder);
    try {
      await this.git.exportCommit(project.path, commit, folder, variables);
    } catch (error) {
      await this.remove(folder);
      throw refusal(error, `Checking out ${branch} of ${project.name} at ${commit} failed.`);
    }
    return { commit };
  }

  /**
   * The tip of the Initiative's branch `branch` as the Project's repository knows it, with no
   * fetch: the newer of the local branch and its copy last fetched from the base branch's remote,
   * which a checkout may have taken. So a page can say the branch has moved past an instance;
   * undefined when it has neither.
   */
  async branchCommitOf(projectId: string, branch: string): Promise<string | undefined> {
    const project = await this.projectOf(projectId);
    const local = await this.git.findCommit(project.path, `refs/heads/${branch}`);
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    const fetched =
      upstream &&
      (await this.git.findCommit(project.path, `refs/remotes/${upstream.remote}/${branch}`));
    if (local === undefined || fetched === undefined) return local ?? fetched;
    return (await this.git.contains(project.path, fetched, local)) ? fetched : local;
  }

  /** Removes a test instance's checkout, best effort: one already gone is no failure. */
  async remove(folder: string): Promise<void> {
    this.ensureTestInstanceFolder(folder);
    await rm(folder, { recursive: true, force: true, maxRetries: REMOVE_RETRIES }).catch(
      () => undefined,
    );
  }

  /** What the Project's run environment image is made from, exactly as a Task's is. */
  async installSettingsOf(projectId: string): Promise<RunEnvironmentInstall> {
    return runEnvironmentInstallOf(await this.projectOf(projectId));
  }

  private async projectOf(projectId: string): Promise<Project> {
    const project = await this.projects.find(projectId);
    if (!project) throw new ProjectNotFound(projectId);
    return project;
  }

  /** A folder removed or written here is a test instance's own, never anywhere else. */
  private ensureTestInstanceFolder(folder: string): void {
    const parent = this.officeData.folder("test-instances");
    const resolved = resolve(folder);
    if (dirname(resolved) !== resolve(parent) || relative(parent, resolved) === "") {
      throw new Error(`${folder} isn't a test instance's folder in ${parent}.`);
    }
  }
}

/** git's failure or an unusable branch as a refusal in `words`; anything else stays as it is. */
function refusal(error: unknown, words: string): unknown {
  if (error instanceof ExistingBranchUnusable) return new ProjectRefused([error.message]);
  if (error instanceof GitCommandFailed) {
    return new ProjectRefused([`${words} git said: ${error.detail}`]);
  }
  return error;
}
