import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git } from "../ports/git.js";
import { RepositoryFiles } from "./repository-files.js";
import { ProjectService } from "./project-service.js";
import { Worktrees } from "./worktrees.js";

/** So a huge file is refused rather than read whole into memory. */
const TEXT_FILE_LIMIT = 1024 * 1024;

/**
 * Committed text files of a Project, for another module to read the repository as committed: at the
 * base branch's last commit known here or fetched now, or at a Task's branch tip; and one folder of
 * a Task's worktree committed on its own, such as the Run environment definition an Agent wrote.
 */
@Injectable()
export class CommittedFiles {
  constructor(
    private readonly projects: ProjectService,
    private readonly git: Git,
    private readonly worktrees: Worktrees,
    private readonly repositoryFiles: RepositoryFiles,
  ) {}

  /** The base branch's last commit known here, with no fetch; undefined when there is none. */
  lastFetchedBase(projectId: string): Promise<string | undefined> {
    return this.repositoryFiles.lastFetched(projectId);
  }

  /** The base branch's commit fetched now, or the last one known here when the fetch fails. */
  async freshBase(projectId: string): Promise<string> {
    return (await this.repositoryFiles.fresh(projectId)).commit;
  }

  /**
   * The commit the Task's branch points at; once the branch is deleted, as at Done or its pull
   * request's merge, the tip kept then. Undefined when it has neither.
   */
  async taskBranchTip(projectId: string, taskId: string): Promise<string | undefined> {
    const project = await this.projects.read(projectId);
    const branch = await this.worktrees.branchOf(project, taskId);
    return (
      (await this.git.findCommit(project.path, `refs/heads/${branch}`)) ??
      (await this.git.findCommit(project.path, this.worktrees.branchTipRefOf(taskId)))
    );
  }

  /**
   * Where the Task's branch, at `tip`, forked from the base branch: as its last Publish recorded
   * it, which holds after the base took the branch in; else where `tip` and `base` last met.
   */
  async taskForkPoint(
    projectId: string,
    taskId: string,
    tip: string,
    base: string,
  ): Promise<string> {
    const project = await this.projects.read(projectId);
    return (
      (await this.git.findCommit(project.path, this.worktrees.publishedFromRefOf(taskId))) ??
      (await this.git.mergeBase(project.path, tip, base))
    );
  }

  /** Whether `path` names a file at `commit`, whatever its size or contents; nothing of it is read. */
  async isFileAt(projectId: string, commit: string, path: string): Promise<boolean> {
    const project = await this.projects.read(projectId);
    return (await this.git.commitTree(project.path, commit).kindOf(path)) === "file";
  }

  /**
   * The uncommitted paths under `folder` (relative to the worktree) of the Task's worktree at
   * `worktree`: staged, unstaged and untracked ones. Refused for a folder that is no Task's worktree.
   */
  async uncommittedPathsUnder(worktree: string, folder: string): Promise<readonly string[]> {
    return this.worktrees.uncommittedPathsUnder(
      await this.projectOfWorktree(worktree),
      worktree,
      folder,
    );
  }

  /**
   * Commits only `folder` of the Task's worktree at `worktree` to the Task's branch, with The
   * Office's identity as a Stage's commit; whatever else is staged or changed stays out and as it
   * was. Returns the branch's commit that holds the folder: the new one, or HEAD when the folder
   * was as committed. Refused for a folder that is no Task's worktree.
   */
  async commitFolder(worktree: string, folder: string, message: string): Promise<string> {
    const project = await this.projectOfWorktree(worktree);
    const commit = await this.worktrees.commitFolder(project, worktree, folder, message);
    return commit ?? (await this.git.commitOf(worktree, "HEAD"));
  }

  /**
   * Puts only `folder` of the Task's worktree at `worktree` back as committed, its untracked files
   * removed; everything else in it stays as it was. Refused for a folder that is no Task's worktree.
   */
  async restoreFolder(worktree: string, folder: string): Promise<readonly string[]> {
    const project = await this.projectOfWorktree(worktree);
    return this.worktrees.restoreFolder(project, worktree, folder);
  }

  /** The text of the file `path` names at `commit`; undefined when it names no file there. */
  async textAt(projectId: string, commit: string, path: string): Promise<string | undefined> {
    const project = await this.projects.read(projectId);
    const tree = this.git.commitTree(project.path, commit);
    if ((await tree.kindOf(path)) !== "file") return undefined;
    if ((await tree.sizeOf(path)) > TEXT_FILE_LIMIT) {
      throw new ProjectRefused([`${path} is over 1 MB, too large to read.`]);
    }
    return tree.textOf(path);
  }

  private async projectOfWorktree(worktree: string): Promise<Project> {
    const projectId = this.worktrees.projectIdOfWorktree(worktree);
    const project = projectId === undefined ? undefined : await this.projects.find(projectId);
    if (
      project === undefined ||
      (await this.worktrees.taskOfWorktree(project, worktree)) === undefined
    ) {
      throw new ProjectRefused([`${worktree} is no Task's worktree.`]);
    }
    return project;
  }
}
