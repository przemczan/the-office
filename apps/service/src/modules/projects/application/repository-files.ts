import { win32 } from "node:path";
import { Injectable } from "@nestjs/common";
import { mediaTypeOf, pictureMediaTypeOf } from "../../../platform/images/image-rules.js";
import type { Project } from "../domain/project.js";
import { ProjectRefused } from "../domain/project-refused.js";
import {
  GIT_OUTPUT_LIMIT_BYTES,
  Git,
  GitCommandFailed,
  type BranchTip,
  type CommitTree,
  type TreeEntry,
  type Upstream,
} from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import { ProjectService } from "./project-service.js";
import { byName, type FolderEntry } from "./repository-folder.js";
import { Worktrees } from "./worktrees.js";

/** So one enormous folder stays usable in the browser. */
export const FOLDER_ENTRIES_LIMIT = 1_000;

/** A full commit id, in SHA-1 or SHA-256. */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A file of a commit is served as one of these, judged from its bytes, never from its name. */
const PLAIN_TEXT = "text/plain; charset=utf-8";
const BINARY = "application/octet-stream";
/** How much of a file is searched for a NUL byte to tell it is no text, as git itself does. */
const BINARY_PROBE_BYTES = 8 * 1024;

/** The commit the Repository file browser reads its folders from. */
export interface BaseBranchCommit {
  readonly commit: string;
  /** Why this is only the last commit known here; undefined when the fetch went well. */
  readonly fetchProblem: string | undefined;
}

/** One folder of a commit. */
export interface RepositoryFolder {
  readonly commit: string;
  readonly path: string;
  /** Folders, then files, each by name, cut to `FOLDER_ENTRIES_LIMIT`. */
  readonly entries: readonly FolderEntry[];
  /** How many there are before the cut. */
  readonly total: number;
}

/** The most a file read through `RepositoryFiles.file` may hold, and the words refusing one over it. */
export interface FileSizeLimit {
  readonly bytes: number;
  readonly problem: string;
}

/**
 * The branches whose files can be browsed: the base branch at its freshest commit known here, then
 * the other local branches and the base branch's remote's, each by name.
 */
export interface RepositoryBranches {
  readonly baseBranch: BranchTip;
  readonly branches: readonly BranchTip[];
  /** Why the remote couldn't be fetched, so these are the last commits known here; else undefined. */
  readonly fetchProblem: string | undefined;
}

/** How a file of a commit shows: its text, as a picture, or only as a download. */
export type FilePreview =
  | { readonly kind: "text"; readonly size: number; readonly text: string }
  | { readonly kind: "image" | "binary" | "too-large"; readonly size: number };

/** A file of a commit to serve, typed by its bytes. */
export interface FileDownload {
  /** The last name of its path. */
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/**
 * The files committed on a Project's branches, read from git's objects a folder or a file at a
 * time, so nothing uncommitted shows and no request walks the whole repository. A caller picks a
 * branch's commit once and reads every folder from it, so they all come from one state of the branch.
 */
@Injectable()
export class RepositoryFiles {
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

  /** The base branch's last commit known here, with no fetch; undefined when there is none. */
  async lastFetched(projectId: string): Promise<string | undefined> {
    const project = await this.projects.read(projectId);
    return this.lastKnownCommit(project, await this.upstreamOf(project));
  }

  /**
   * The branches to browse. With `fetch`, every branch of the base branch's upstream remote is
   * fetched first, pruning none; a fetch that fails answers what is known here, with why.
   */
  async branches(
    projectId: string,
    { fetch }: { readonly fetch: boolean },
  ): Promise<RepositoryBranches> {
    const project = await this.projects.read(projectId);
    const upstream = await this.upstreamOf(project);
    let fetchProblem: string | undefined;
    if (fetch && upstream !== undefined) {
      try {
        const variables = this.commands.variablesFor(project.environment);
        await this.git.fetchRemote(project.path, upstream.remote, variables);
      } catch (error) {
        // Any Error, as `fresh` takes it.
        if (!(error instanceof Error)) throw error;
        fetchProblem = await this.reasonOf(project, error);
      }
    }
    const commit = await this.lastKnownCommit(project, upstream);
    if (commit === undefined) {
      const why = fetchProblem === undefined ? "" : ` ${fetchProblem}`;
      throw new ProjectRefused([
        `${project.name}'s base branch ${project.baseBranch} has no commit here.${why}`,
      ]);
    }
    const tips = await this.git.branchTips(project.path, upstream?.remote);
    const others = tips.filter((tip) => !(tip.kind === "local" && tip.name === project.baseBranch));
    return {
      baseBranch: { name: project.baseBranch, kind: "local", commit },
      branches: [
        ...others.filter(({ kind }) => kind === "local").toSorted(byName),
        ...others.filter(({ kind }) => kind === "remote").toSorted(byName),
      ],
      fetchProblem,
    };
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
  ): Promise<RepositoryFolder> {
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
    const tree = await this.fileTreeAt(projectId, commit, path);
    if ((await tree.sizeOf(path)) > limit.bytes) throw new ProjectRefused([limit.problem]);
    return tree.bytesOf(path);
  }

  /**
   * How the file `path` names at `commit` shows. Its size is asked first, so a file over
   * `previewBytes` is never read; the rest are judged by their bytes as `download` types them.
   */
  async preview(
    projectId: string,
    commit: string,
    path: string,
    previewBytes: number,
  ): Promise<FilePreview> {
    const tree = await this.fileTreeAt(projectId, commit, path);
    const size = await tree.sizeOf(path);
    if (size > previewBytes) return { kind: "too-large", size };
    const bytes = await tree.bytesOf(path);
    const mediaType = fileMediaTypeOf(bytes);
    if (mediaType.startsWith("image/")) return { kind: "image", size };
    if (mediaType === PLAIN_TEXT)
      return { kind: "text", size, text: new TextDecoder().decode(bytes) };
    return { kind: "binary", size };
  }

  /**
   * The file `path` names at `commit`, typed by its bytes: a picture or an SVG as an image, UTF-8
   * text as plain text, so the browser runs nothing of it, and anything else as bytes. A file over
   * what git prints for one command is refused, as it can't be read whole.
   */
  async download(projectId: string, commit: string, path: string): Promise<FileDownload> {
    const megabytes = GIT_OUTPUT_LIMIT_BYTES / 1024 / 1024;
    const bytes = await this.file(projectId, commit, path, {
      bytes: GIT_OUTPUT_LIMIT_BYTES,
      problem: `${path} is over ${megabytes} MB, more than The Office reads from git.`,
    });
    return { name: path.split("/").at(-1) ?? path, mediaType: fileMediaTypeOf(bytes), bytes };
  }

  /** `treeAt`, refusing a `path` that names no file there. */
  private async fileTreeAt(projectId: string, commit: string, path: string): Promise<CommitTree> {
    const tree = await this.treeAt(projectId, commit, path);
    if ((await tree.kindOf(path)) !== "file") {
      throw new ProjectRefused([`The repository has no file ${path} at this commit.`]);
    }
    return tree;
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
    const commit = await this.lastKnownCommit(project, await this.upstreamOf(project));
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

  /** The remote branch the base branch tracks; undefined when none, or no repository is there. */
  private async upstreamOf(project: Project): Promise<Upstream | undefined> {
    return this.git.upstreamOf(project.path, project.baseBranch).catch((error: unknown) => {
      if (error instanceof GitCommandFailed) return undefined;
      throw error;
    });
  }

  /** Where the last fetch left the upstream, or the local base branch before any fetch reached it. */
  private async lastKnownCommit(
    project: Project,
    upstream: Upstream | undefined,
  ): Promise<string | undefined> {
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

/** A picture by its signature, an SVG by its root, text as plain text, anything else as bytes. */
function fileMediaTypeOf(bytes: Uint8Array): string {
  const picture = pictureMediaTypeOf(bytes);
  if (picture !== undefined) return picture;
  if (!isText(bytes)) return BINARY;
  return mediaTypeOf(bytes) === "image/svg+xml" ? "image/svg+xml" : PLAIN_TEXT;
}

/**
 * Valid UTF-8 with no NUL byte near its start: the rule of Work's `isText` (domain/attachment.ts),
 * written again here as one module's domain can't be another's import.
 */
function isText(bytes: Uint8Array): boolean {
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
