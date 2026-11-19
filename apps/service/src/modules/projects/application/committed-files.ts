import { Injectable } from "@nestjs/common";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git } from "../ports/git.js";
import { RepositoryFiles } from "./repository-files.js";
import { ProjectService } from "./project-service.js";
import { Worktrees } from "./worktrees.js";

/** So a huge file is refused rather than read whole into memory. */
const TEXT_FILE_LIMIT = 1024 * 1024;

/**
 * Committed text files of a Project, for another module to read the repository as committed: at the
 * base branch's last commit known here or fetched now, or at a Task's branch tip.
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

  /** The commit the Task's branch points at; undefined when it has no branch. */
  async taskBranchTip(projectId: string, taskId: string): Promise<string | undefined> {
    const project = await this.projects.read(projectId);
    const branch = await this.worktrees.branchOf(project, taskId);
    return this.git.findCommit(project.path, `refs/heads/${branch}`);
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
}
