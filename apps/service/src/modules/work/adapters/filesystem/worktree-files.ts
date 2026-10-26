import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { ATTACHMENT_SIZE_LIMIT } from "../../domain/attachment.js";
import { AttachmentRefused } from "../../domain/attachment-refused.js";

/** A file an Agent attaches from the Task's worktree, read whole. */
export interface WorktreeFile {
  readonly name: string;
  readonly content: Uint8Array;
}

/**
 * Reads the file at `path`, relative to the worktree or absolute inside it. Refused for a file
 * outside the worktree, a link leading out of it included, inside its `.git`, or too big to attach.
 */
export async function readWorktreeFile(worktree: string, path: string): Promise<WorktreeFile> {
  const root = await realpath(worktree);
  const filePath = await realpath(resolve(root, path)).catch(() => {
    throw new AttachmentRefused([`There is no file at ${path} in the Task's worktree.`]);
  });
  const inside = relative(root, filePath);
  const [first] = inside.split(sep);
  if (inside === "" || first === ".." || isAbsolute(inside)) {
    throw new AttachmentRefused(["Attach a file from the Task's worktree."]);
  }
  if (first === ".git") {
    throw new AttachmentRefused(["Git's own files are not attached."]);
  }
  const file = await stat(filePath);
  if (!file.isFile()) throw new AttachmentRefused([`${path} is not a file.`]);
  if (file.size > ATTACHMENT_SIZE_LIMIT) {
    throw new AttachmentRefused([
      `A file may be at most ${ATTACHMENT_SIZE_LIMIT / 1024 / 1024} MB.`,
    ]);
  }
  return { name: basename(filePath), content: await readFile(filePath) };
}
