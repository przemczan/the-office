import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { Injectable } from "@nestjs/common";
import { ATTACHMENT_SIZE_LIMIT } from "../../domain/attachment.js";
import { AttachmentRefused } from "../../domain/attachment-refused.js";
import {
  WorktreeFiles,
  type WorktreeFile,
  type WorktreeFileLimits,
} from "../../ports/worktree-files.js";

/**
 * Reads the file at `path`, relative to the worktree or absolute inside it. Refused for a file
 * outside the worktree, a link leading out of it included, inside its `.git`, outside the folder
 * `limits.within` names, or bigger than `limits.sizeLimit` (an Attachment's limit by default).
 */
export async function readWorktreeFile(
  worktree: string,
  path: string,
  { within, sizeLimit = ATTACHMENT_SIZE_LIMIT }: WorktreeFileLimits = {},
): Promise<WorktreeFile> {
  const root = await realpath(worktree);
  const filePath = await realpath(resolve(root, within ?? "", path)).catch(() => {
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
  if (within !== undefined && !isInside(resolve(root, within), filePath)) {
    throw new AttachmentRefused([`${path} is not in ${within}.`]);
  }
  const file = await stat(filePath);
  if (!file.isFile()) throw new AttachmentRefused([`${path} is not a file.`]);
  if (file.size > sizeLimit) {
    throw new AttachmentRefused([`${path} is over ${sizeWords(sizeLimit)}.`]);
  }
  return {
    path: inside.split(sep).join("/"),
    name: basename(filePath),
    content: await readFile(filePath),
  };
}

/** The Task's worktree files, read as readWorktreeFile reads them. */
@Injectable()
export class FilesystemWorktreeFiles extends WorktreeFiles {
  read(worktree: string, path: string, limits?: WorktreeFileLimits): Promise<WorktreeFile> {
    return readWorktreeFile(worktree, path, limits);
  }
}

function isInside(folder: string, filePath: string): boolean {
  const inside = relative(folder, filePath);
  return inside !== "" && !inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside);
}

function sizeWords(bytes: number): string {
  return `${bytes / 1024 / 1024} MB`;
}
