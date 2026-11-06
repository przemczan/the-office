import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommitTree } from "../../ports/git.js";
import { reachedUrlOf } from "./git-clone.js";
import { commitTreeOf } from "./git-commit-tree.js";
import type { GitProcess } from "./git-process.js";

/** One commit of a large repository still takes a while to come over the network. */
const FETCH_TIMEOUT_MS = 300_000;
/** Windows can hold a pack file open for a moment after git exits. */
const REMOVE_RETRIES = 5;

/**
 * Fetches `branch` alone, one commit deep and without tags, into a bare repository in a temp folder,
 * on the URL git reaches for `url` so the command gets that remote's identity, and removes it after
 * `read`. Read from git's objects, so no checkout runs a filter or writes a file.
 */
export async function readBranchTip<Result>(
  git: GitProcess,
  url: string,
  branch: string,
  read: (tip: CommitTree) => Promise<Result>,
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
    return await read(commitTreeOf(git, repository, commit));
  } finally {
    await rm(repository, { recursive: true, force: true, maxRetries: REMOVE_RETRIES });
  }
}
