import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { CloneProgress } from "../../domain/repository-clone.js";
import type { CloneRequest, RemoteBranches } from "../../ports/git.js";
import type { GitProcess } from "./git-process.js";

/** Reading a remote's branches is one round trip, however large the repository. */
const LS_REMOTE_TIMEOUT_MS = 120_000;
/** A folder git has only just let go of may still be held on Windows for a moment. */
const MOVE_RETRIES = 5;
const MOVE_RETRY_DELAY_MS = 200;
/** `Receiving objects:  45% (450/1000)`, and the same with `remote: ` in front. */
const PROGRESS_LINE = /^(?:remote: )?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/;
/** `Cloning into 'shop'...`, which comes before any percentage. */
const STARTING_LINE = /^Cloning into /;

/** `ls-remote --symref <url> HEAD refs/heads/*`: the default branch and every branch. */
export async function remoteBranchesOf(git: GitProcess, url: string): Promise<RemoteBranches> {
  const output = await git.output({
    folder: tmpdir(),
    gitArguments: ["ls-remote", "--symref", "--", url, "HEAD", "refs/heads/*"],
    remote: url,
    timeoutMs: LS_REMOTE_TIMEOUT_MS,
  });
  let defaultBranch: string | undefined;
  const branches: string[] = [];
  for (const line of output.split("\n")) {
    const symbolic = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(line);
    if (symbolic) defaultBranch = symbolic[1];
    const branch = /^[0-9a-f]+\trefs\/heads\/(.+)$/.exec(line);
    if (branch?.[1] !== undefined) branches.push(branch[1]);
  }
  return { defaultBranch, branches };
}

/**
 * Clones into a hidden folder beside `folder` and moves it there once git is done, so a crash or a
 * failure leaves no half clone where a later add would find it.
 */
export async function cloneRepository(git: GitProcess, request: CloneRequest): Promise<void> {
  const parent = dirname(request.folder);
  const cloning = join(parent, `.${basename(request.folder)}.cloning-${randomUUID().slice(0, 8)}`);
  await mkdir(parent, { recursive: true });
  try {
    await git.output({
      folder: parent,
      gitArguments: ["clone", "--progress", "--", request.url, cloning],
      remote: request.url,
      timeoutMs: 0,
      signal: request.signal,
      onStandardError: progressReader(request.onProgress),
    });
    await moveWhenFree(cloning, request.folder);
  } finally {
    await rm(cloning, { recursive: true, force: true, maxRetries: MOVE_RETRIES });
  }
}

/** Reads git's progress, which rewrites one line with `\r` and may arrive cut anywhere. */
function progressReader(onProgress: (progress: CloneProgress) => void): (text: string) => void {
  let unfinished = "";
  return (text) => {
    const lines = (unfinished + text).split(/[\r\n]/);
    unfinished = lines.pop() ?? "";
    for (const line of lines) {
      const progress = progressOf(line);
      if (progress) onProgress(progress);
    }
  };
}

export function progressOf(line: string): CloneProgress | undefined {
  if (STARTING_LINE.test(line)) return { phase: "Cloning", percent: undefined };
  const match = PROGRESS_LINE.exec(line);
  if (!match?.[1] || match[2] === undefined) return undefined;
  return { phase: match[1], percent: Math.min(Number(match[2]), 100) };
}

async function moveWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === "EPERM";
      if (!busy || attempt === MOVE_RETRIES) throw error;
      await sleep(MOVE_RETRY_DELAY_MS * attempt);
    }
  }
}
