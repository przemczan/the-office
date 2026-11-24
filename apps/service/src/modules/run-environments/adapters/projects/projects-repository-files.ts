import { Injectable } from "@nestjs/common";
import { CommittedFiles } from "../../../projects/index.js";
import { RepositoryFiles } from "../../ports/repository-files.js";
import { refusedInOurWords } from "./projects-settings.js";

/** A Project's committed files, read through Projects' `CommittedFiles`. */
@Injectable()
export class ProjectsRepositoryFiles extends RepositoryFiles {
  constructor(private readonly files: CommittedFiles) {
    super();
  }

  lastFetchedBase(projectId: string): Promise<string | undefined> {
    return this.files.lastFetchedBase(projectId);
  }

  freshBase(projectId: string): Promise<string> {
    return refusedInOurWords(() => this.files.freshBase(projectId));
  }

  taskBranchTip(projectId: string, taskId: string): Promise<string | undefined> {
    return this.files.taskBranchTip(projectId, taskId);
  }

  taskForkPoint(projectId: string, taskId: string, tip: string, base: string): Promise<string> {
    return refusedInOurWords(() => this.files.taskForkPoint(projectId, taskId, tip, base));
  }

  textAt(projectId: string, commit: string, path: string): Promise<string | undefined> {
    return refusedInOurWords(() => this.files.textAt(projectId, commit, path));
  }

  uncommittedPathsUnder(worktree: string, folder: string): Promise<readonly string[]> {
    return refusedInOurWords(() => this.files.uncommittedPathsUnder(worktree, folder));
  }

  commitFolder(worktree: string, folder: string, message: string): Promise<string> {
    return refusedInOurWords(() => this.files.commitFolder(worktree, folder, message));
  }

  async restoreFolder(worktree: string, folder: string): Promise<void> {
    await refusedInOurWords(() => this.files.restoreFolder(worktree, folder));
  }
}
