import { posix } from "node:path";
import { Injectable } from "@nestjs/common";
import { ProjectRefused } from "../domain/project-refused.js";
import {
  Git,
  GitCommandFailed,
  type FetchedBranchTip,
  type RemoteBranches,
  type TreeEntry,
} from "../ports/git.js";
import { ProjectRemotes } from "./project-remotes.js";
import {
  byName,
  isManifest,
  manifestOf,
  type FolderEntry,
  type RepositoryFolder,
} from "./repository-folder.js";
import { readRepositoryUrl } from "./repository-url.js";

/** What a repository on a host holds in one folder of its default branch, and its branches. */
export interface RepositoryByUrl extends RepositoryFolder {
  /** The Repository URL as given, without the spaces around it. */
  readonly url: string;
  readonly defaultBranch: string;
  /** The default branch's last commit, the one read. */
  readonly commit: string;
  readonly branches: readonly string[];
}

/**
 * Reads a repository by its Repository URL before it is a Project, for Devops to onboard it from
 * their chat (spec §2.1), as `LocalRepositories` reads one on the workstation: its branches on the
 * remote, and the names and manifest files of one folder of its default branch. Read from a fetch of
 * that branch's last commit alone, on the Office identity, removed after: nothing is cloned or kept.
 */
@Injectable()
export class RepositoriesByUrl {
  constructor(
    private readonly git: Git,
    private readonly remotes: ProjectRemotes,
  ) {}

  async read(givenUrl: string, folder = ""): Promise<RepositoryByUrl> {
    const url = clonedUrlOf(givenUrl);
    const treeFolder = treeFolderOf(folder);
    const { defaultBranch, branches } = await this.remoteBranchesOf(url);
    if (defaultBranch === undefined) {
      throw new ProjectRefused(["The repository has no commits yet, so nothing to read."]);
    }
    return this.refusingGitFailures(url, () =>
      this.git.readBranchTip(url, defaultBranch, async (tip) => ({
        url,
        defaultBranch,
        commit: tip.commit,
        branches,
        ...(await folderOf(tip, treeFolder, folder)),
      })),
    );
  }

  /**
   * The repository's branches on its remote, read on the Office identity with nothing fetched;
   * refused, in words, for a URL The Office doesn't clone and a remote it can't reach.
   */
  async remoteBranchesOf(givenUrl: string): Promise<RemoteBranches> {
    const url = clonedUrlOf(givenUrl);
    const unreachable = await this.remotes.whyUnreachable(url);
    if (unreachable !== undefined) throw new ProjectRefused([unreachable]);
    return this.refusingGitFailures(url, () => this.git.remoteBranches(url));
  }

  /** Runs `read` on `url`, refusing with what the identity lacks or git's words when git fails. */
  private async refusingGitFailures<T>(url: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof GitCommandFailed)) throw error;
      const reason = await this.remotes.whyCloneFailed(url);
      throw new ProjectRefused([reason ?? `git couldn't read the repository: ${error.detail}`]);
    }
  }
}

/** The Repository URL as given, without the spaces around it; refused when The Office doesn't clone it. */
function clonedUrlOf(givenUrl: string): string {
  const reading = readRepositoryUrl(givenUrl);
  if (reading.kind === "refused") throw new ProjectRefused([reading.problem]);
  return reading.repositoryUrl.url;
}

/** The folder `folder` names in the tree, refused when it leaves the repository or is git's own. */
function treeFolderOf(folder: string): string {
  const slashed = folder.replaceAll("\\", "/");
  if (posix.isAbsolute(slashed) || /^[A-Za-z]:/.test(slashed)) {
    throw new ProjectRefused([
      `Give the folder relative to the repository's top level, not as a full path: ${folder}.`,
    ]);
  }
  const normalized = posix.normalize(slashed).replace(/\/+$/, "");
  const inside = normalized === "." ? "" : normalized;
  const names = inside.split("/");
  if (names[0] === ".." || names.includes(".git")) {
    throw new ProjectRefused([`${folder} is not a folder inside the repository.`]);
  }
  return inside;
}

async function folderOf(
  tip: FetchedBranchTip,
  treeFolder: string,
  folder: string,
): Promise<RepositoryFolder> {
  switch (await tip.kindOf(treeFolder)) {
    case "missing":
      throw new ProjectRefused([`The repository has no folder ${folder}.`]);
    case "file":
      throw new ProjectRefused([`${folder} is a file, not a folder.`]);
    case "submodule":
      throw new ProjectRefused([
        `${folder} is a submodule, another repository: read it by its own URL.`,
      ]);
    case "folder":
      break;
  }
  const entries = (await tip.entriesOf(treeFolder)).toSorted(byName);
  // A link is listed but never followed.
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.kind === "file" && isManifest(entry.name))
      .map(async ({ name }) => manifestOf(name, await tip.textOf(posix.join(treeFolder, name)))),
  );
  return { folder: treeFolder, entries: entries.map(folderEntryOf), manifests };
}

/** Listed as the workstation lists it: a submodule is a folder, a link a file. */
function folderEntryOf({ name, kind }: TreeEntry): FolderEntry {
  return { name, kind: kind === "folder" || kind === "submodule" ? "folder" : "file" };
}
