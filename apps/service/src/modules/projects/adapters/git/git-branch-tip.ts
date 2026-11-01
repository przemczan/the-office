import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchedBranchTip, TreeEntry, TreePathKind } from "../../ports/git.js";
import { reachedUrlOf } from "./git-clone.js";
import type { GitProcess } from "./git-process.js";

/** One commit of a large repository still takes a while to come over the network. */
const FETCH_TIMEOUT_MS = 300_000;
/** Windows can hold a pack file open for a moment after git exits. */
const REMOVE_RETRIES = 5;
/** `<mode> <type> <object>\t<name>`, as `ls-tree -z` prints each entry. */
const TREE_LINE = /^(\d{6}) \w+ [0-9a-f]+\t(.+)$/s;

/**
 * Fetches `branch` alone, one commit deep and without tags, into a bare repository in a temp folder,
 * on the URL git reaches for `url` so the command gets that remote's identity, and removes it after
 * `read`. Read from git's objects, so no checkout runs a filter or writes a file.
 */
export async function readBranchTip<Result>(
  git: GitProcess,
  url: string,
  branch: string,
  read: (tip: FetchedBranchTip) => Promise<Result>,
): Promise<Result> {
  const repository = await mkdtemp(join(tmpdir(), "office-repository-"));
  try {
    await git.output({ folder: repository, gitArguments: ["init", "--quiet", "--bare"] });
    await git.output({
      folder: repository,
      gitArguments: [
        "fetch",
        "--quiet",
        "--depth",
        "1",
        "--no-tags",
        "--",
        url,
        `refs/heads/${branch}`,
      ],
      remote: await reachedUrlOf(git, url),
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    const commit = (
      await git.output({ folder: repository, gitArguments: ["rev-parse", "FETCH_HEAD^{commit}"] })
    ).trim();
    return await read(fetchedTip(git, repository, commit));
  } finally {
    await rm(repository, { recursive: true, force: true, maxRetries: REMOVE_RETRIES });
  }
}

function fetchedTip(git: GitProcess, repository: string, commit: string): FetchedBranchTip {
  // `<commit>:` names the top-level tree, `<commit>:<path>` what is at that path.
  const object = (path: string): string => `${commit}:${path}`;
  return {
    commit,
    kindOf: async (path) => {
      if (path === "") return "folder";
      // The entry itself, by its mode: a submodule's commit isn't in these objects to ask for its type.
      const output = await git.output({
        folder: repository,
        gitArguments: ["ls-tree", "-z", commit, "--", path],
      });
      const entry = output.split("\0").find((line) => line !== "");
      return entry === undefined ? "missing" : pathKindOf(treeEntryOf(entry).kind);
    },
    entriesOf: async (folder) => {
      const output = await git.output({
        folder: repository,
        gitArguments: ["ls-tree", "-z", object(folder)],
      });
      return output
        .split("\0")
        .filter((line) => line !== "")
        .map(treeEntryOf);
    },
    textOf: (path) =>
      git.output({ folder: repository, gitArguments: ["cat-file", "blob", object(path)] }),
  };
}

/** A link is never followed, so it is read as the file it is. */
function pathKindOf(kind: TreeEntry["kind"]): TreePathKind {
  return kind === "link" ? "file" : kind;
}

function treeEntryOf(line: string): TreeEntry {
  const match = TREE_LINE.exec(line);
  if (!match?.[1] || match[2] === undefined)
    throw new Error(`git ls-tree printed an unknown line: ${line}`);
  return { name: match[2], kind: kindOfMode(match[1]) };
}

function kindOfMode(mode: string): TreeEntry["kind"] {
  switch (mode) {
    case "040000":
      return "folder";
    case "120000":
      return "link";
    case "160000":
      return "submodule";
    default:
      return "file";
  }
}
