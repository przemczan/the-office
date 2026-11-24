import { rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { ProjectRefused } from "../domain/project-refused.js";
import type { Project } from "../domain/project.js";
import { ExistingBranchUnusable } from "../domain/task-base.js";
import { Git, GitCommandFailed } from "../ports/git.js";
import type { ProjectCommandRunner } from "./project-command-runner.js";
import type { TaskBases } from "./task-bases.js";

const REMOVE_RETRIES = 5;

/**
 * What a test instance's checkout and an Action run's share (spec §5.5, "A test instance's
 * checkout", "An Action run's checkout"): a branch's tip fetched by the same rules, its files written
 * into a folder of its own with no `.git` at all, and that folder removed; every folder one directly
 * inside `parent`, never anywhere else.
 */
export class DetachedCheckouts {
  constructor(
    private readonly taskBases: TaskBases,
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    /** The folder every checkout is directly inside, such as `<office-data>/test-instances/`. */
    private readonly parent: string,
    /** Whose folder it is, in an error's words, such as "a test instance's". */
    private readonly owner: string,
  ) {}

  /**
   * The tip of the branch, fetched first (`TaskBases.freshBranchTip`). Refused (ProjectRefused)
   * when neither the repository nor its remote has the branch, the two have diverged, or git fails.
   */
  async freshTip(project: Project, branch: string): Promise<string> {
    const variables = this.commands.variablesFor(project.environment);
    return this.git
      .exclusively(project.path, () => this.taskBases.freshBranchTip(project, branch, variables))
      .catch((error: unknown) => {
        throw branchRefusal(error, `Fetching ${branch} of ${project.name} failed.`);
      });
  }

  /**
   * Makes `folder` hold the files of `commit` alone, replacing anything it held; a failed export
   * leaves no folder. `branch` names it in a refusal.
   */
  async exportInto(
    project: Project,
    branch: string,
    commit: string,
    folder: string,
  ): Promise<void> {
    this.ensureInside(folder);
    await this.remove(folder);
    try {
      await this.git.exportCommit(
        project.path,
        commit,
        folder,
        this.commands.variablesFor(project.environment),
      );
    } catch (error) {
      await this.remove(folder);
      throw branchRefusal(error, `Checking out ${branch} of ${project.name} at ${commit} failed.`);
    }
  }

  /** Removes a checkout, best effort: one already gone is no failure. */
  async remove(folder: string): Promise<void> {
    this.ensureInside(folder);
    await rm(folder, { recursive: true, force: true, maxRetries: REMOVE_RETRIES }).catch(
      () => undefined,
    );
  }

  /** A folder removed or written here is one directly inside `parent`, never anywhere else. */
  ensureInside(folder: string): void {
    const resolved = resolve(folder);
    if (dirname(resolved) !== resolve(this.parent) || relative(this.parent, resolved) === "") {
      throw new Error(`${folder} isn't ${this.owner} folder in ${this.parent}.`);
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
