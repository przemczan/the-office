import { win32 } from "node:path";
import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git, GitCommandFailed, type CommitTree, type TreeEntry } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import { ProjectService } from "./project-service.js";
import { byName, type FolderEntry } from "./repository-folder.js";
import { Worktrees } from "./worktrees.js";

/** So one enormous folder stays usable in the browser. */
export const FOLDER_ENTRIES_LIMIT = 1_000;

/** A full commit id, in SHA-1 or SHA-256. */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The commit the Repository file browser reads its folders from. */
export interface BaseBranchCommit {
  readonly commit: string;
  /** Why this is only the last commit known here; undefined when the fetch went well. */
  readonly fetchProblem: string | undefined;
}

/** One folder of a commit on the base branch. */
export interface BaseBranchFolder {
  readonly commit: string;
  readonly path: string;
  /** Folders, then files, each by name, cut to `FOLDER_ENTRIES_LIMIT`. */
  readonly entries: readonly FolderEntry[];
  /** How many there are before the cut. */
  readonly total: number;
}

/** The most a file read through `BaseBranchFiles.file` may hold, and the words refusing one over it. */
export interface FileSizeLimit {
  readonly bytes: number;
  readonly problem: string;
}

/**
 * The files committed on a Project's base branch, read from git's objects a folder at a time, so
 * nothing uncommitted shows and no request walks the whole repository. A caller fetches once and
 * reads every folder from that commit, so they all come from one state of the branch.
 */
@Injectable()
export class BaseBranchFiles {
  constructor(
    private readonly projects: ProjectService,
    private readonly git: Git,
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
    private readonly remotes: ProjectRemotes,
  ) {}

  /** The base branch's commit once fetched, or the last one known here when the fetch fails. */
  async fresh(projectId: string): Promise<BaseBranchCommit> {
    const project = await this.projects.read(projectId);
    try {
      const variables = this.commands.variablesFor(project.environment);
      const { commit } = await this.worktrees.freshBase(project, variables);
      return { commit, fetchProblem: undefined };
    } catch (error) {
      // Any Error, as a fetch that times out is a plain one, not a GitCommandFailed.
      if (!(error instanceof Error)) throw error;
      return this.lastKnown(project, error);
    }
  }

  /**
   * What `path` holds at `commit`: every folder, since finding those holding a match would walk the
   * whole tree, and the files ending in one of `extensions`, or all of them when none is given.
   * Links and submodules are left out: neither is a file of this repository to pick.
   */
  async folder(
    projectId: string,
    commit: string,
    path: string,
    extensions: readonly string[],
  ): Promise<BaseBranchFolder> {
    const tree = await this.treeAt(projectId, commit, path);
    if ((await tree.kindOf(path)) !== "folder") {
      throw new ProjectRefused([`The repository has no folder ${path} at this commit.`]);
    }
    const inFolder = await tree.entriesOf(path);
    const matches = matcherOf(extensions);
    const entries = [
      ...inFolder.filter(isFolder).toSorted(byName),
      ...inFolder
        .filter(isFile)
        .filter(({ name }) => matches(name))
        .toSorted(byName),
    ];
    return {
      commit,
      path,
      entries: entries.slice(0, FOLDER_ENTRIES_LIMIT),
      total: entries.length,
    };
  }

  /**
   * The bytes of the file `path` names at `commit`, as committed. Its size is asked first, so a huge
   * file is refused rather than read. A link is read as what git holds for it, the target's path.
   */
  async file(
    projectId: string,
    commit: string,
    path: string,
    limit: FileSizeLimit,
  ): Promise<Uint8Array> {
    const tree = await this.treeAt(projectId, commit, path);
    if ((await tree.kindOf(path)) !== "file") {
      throw new ProjectRefused([`The repository has no file ${path} at this commit.`]);
    }
    if ((await tree.sizeOf(path)) > limit.bytes) throw new ProjectRefused([limit.problem]);
    return tree.bytesOf(path);
  }

  /** The tree to read `path` from, refusing a `path` no commit could hold or a `commit` not here. */
  private async treeAt(projectId: string, commit: string, path: string): Promise<CommitTree> {
    const project = await this.projects.read(projectId);
    const problem = pathProblem(path);
    if (problem !== undefined) throw new ProjectRefused([problem]);
    if (!COMMIT_ID.test(commit) || !(await this.git.findCommit(project.path, commit))) {
      throw new ProjectRefused([`The repository holds no commit ${commit}.`]);
    }
    return this.git.commitTree(project.path, commit);
  }

  private async lastKnown(project: Project, failure: Error): Promise<BaseBranchCommit> {
    const reason = await this.reasonOf(project, failure);
    const commit = await this.lastKnownCommit(project);
    if (commit === undefined) {
      throw new ProjectRefused([
        `${project.name}'s base branch ${project.baseBranch} can't be read: ${reason}`,
      ]);
    }
    return { commit, fetchProblem: reason };
  }

  /** git's own words, after what the Office identity lacks for the remote when it lacks something. */
  private async reasonOf(project: Project, failure: Error): Promise<string> {
    const problem = failure instanceof GitCommandFailed ? failure.detail : failure.message;
    const lacking = await this.remotes.whyFetchFailed(project);
    return lacking === undefined ? problem : `${lacking} ${problem}`;
  }

  /** Where the last fetch left the upstream, or the local base branch before any fetch reached it. */
  private async lastKnownCommit(project: Project): Promise<string | undefined> {
    const upstream = await this.git
      .upstreamOf(project.path, project.baseBranch)
      .catch((error: unknown) => {
        if (error instanceof GitCommandFailed) return undefined;
        throw error;
      });
    const fetched =
      upstream &&
      (await this.git.findCommit(
        project.path,
        `refs/remotes/${upstream.remote}/${upstream.branch}`,
      ));
    return fetched ?? this.git.findCommit(project.path, `refs/heads/${project.baseBranch}`);
  }
}

function isFolder(entry: TreeEntry): entry is FolderEntry {
  return entry.kind === "folder";
}

function isFile(entry: TreeEntry): entry is FolderEntry {
  return entry.kind === "file";
}

/** Why `path` can't name anything in a commit's tree, whatever the commit holds. */
function pathProblem(path: string): string | undefined {
  if (path === "") return undefined;
  // win32's rule covers both systems: `/a`, `\a` and `C:\a`.
  if (win32.isAbsolute(path)) {
    return `Give the path relative to the repository's top level, not as a full path: ${path}.`;
  }
  const leaves = path.split("/").some((name) => name === "" || name === "." || name === "..");
  return leaves || path.includes("\0") ? `${path} is not a path inside the repository.` : undefined;
}

/** Matches the end of a name in any case; an extension may be given with its dot or without. */
function matcherOf(extensions: readonly string[]): (name: string) => boolean {
  const endings = extensions.map((extension) => `.${extension.replace(/^\./, "").toLowerCase()}`);
  if (endings.length === 0) return () => true;
  return (name) => {
    const lowered = name.toLowerCase();
    return endings.some((ending) => lowered.endsWith(ending));
  };
}
