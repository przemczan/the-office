import { rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { CommandOutcome } from "../domain/command-run.js";
import type { ProjectVariable } from "../domain/project-environment.js";
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
 * A Build to install test instance's build on the workstation, with the Project's Run environment
 * Off (spec §2.12, "Build to install"), the way checks run there.
 */
export interface WorkstationBuild {
  /** The instance's checkout, one directly inside `<office-data>/test-instances/`. */
  readonly checkout: string;
  /** The folder it runs in, relative to the checkout: a package script's manifest's. */
  readonly folder: string;
  /** A POSIX shell command line, every word quoted. */
  readonly commandLine: string;
  /** The target's own variables, the only ones it gets beside the service's own. */
  readonly variables: readonly ProjectVariable[];
  /** Its output is appended there as it comes, the target's Secret variables masked. */
  readonly logFile: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** How a build ended. */
export interface WorkstationBuildEnd {
  readonly outcome: CommandOutcome;
  /** Undefined when it never exited by itself. */
  readonly exitCode: number | undefined;
}

/**
 * A test instance's own checkout of a branch of a Project (spec §5.5, "A test
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
   * the branch `branch`, fetched first (`TaskBases.freshBranchTip`), replacing anything it held,
   * and answers the commit. Refused (ProjectRefused) when neither the repository nor its remote has
   * the branch or the two have diverged, when git fails, or for a folder elsewhere; a failed
   * checkout leaves no folder.
   */
  async checkOut(projectId: string, branch: string, folder: string): Promise<{ commit: string }> {
    this.ensureTestInstanceFolder(folder);
    const project = await this.projectOf(projectId);
    const variables = this.commands.variablesFor(project.environment);
    const commit = await this.git
      .exclusively(project.path, () => this.taskBases.freshBranchTip(project, branch, variables))
      .catch((error: unknown) => {
        throw branchRefusal(error, `Fetching ${branch} of ${project.name} failed.`);
      });
    await this.remove(folder);
    try {
      await this.git.exportCommit(project.path, commit, folder, variables);
    } catch (error) {
      await this.remove(folder);
      throw branchRefusal(error, `Checking out ${branch} of ${project.name} at ${commit} failed.`);
    }
    return { commit };
  }

  /**
   * The tip of the branch `branch` as the Project's repository knows it, with no
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

  /**
   * Runs a build in a test instance's checkout on the workstation: in the Bash Agents have, so its
   * POSIX quoting holds on Windows too, with the service's variables less The Office's and the
   * target's over them; never the Project's environment, whose Secret variables it must not see.
   */
  async runBuild(build: WorkstationBuild): Promise<WorkstationBuildEnd> {
    this.ensureTestInstanceFolder(build.checkout);
    const folder = join(build.checkout, build.folder);
    const fromCheckout = relative(build.checkout, folder);
    if (fromCheckout === ".." || fromCheckout.startsWith(`..${sep}`) || isAbsolute(fromCheckout)) {
      throw new ProjectRefused([`The folder ${build.folder} isn't in the checkout.`]);
    }
    const { outcome, exitCode } = await this.commands.run({
      commandLine: build.commandLine,
      folder,
      environment: { set: build.variables, unset: [], prependPath: [] },
      timeoutMs: build.timeoutMs,
      signal: build.signal,
      outputFile: build.logFile,
      appendOutput: true,
      inAgentBash: true,
    });
    return { outcome, exitCode };
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
export function branchRefusal(error: unknown, words: string): unknown {
  if (error instanceof ExistingBranchUnusable) return new ProjectRefused([error.message]);
  if (error instanceof GitCommandFailed) {
    return new ProjectRefused([`${words} git said: ${error.detail}`]);
  }
  return error;
}
