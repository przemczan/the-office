/** A file from a Task's worktree, read whole. */
export interface WorktreeFile {
  readonly name: string;
  readonly content: Uint8Array;
}

/** What a file read from a worktree must keep to. */
export interface WorktreeFileLimits {
  /** The folder, relative to the worktree, the file must be in; its path is read relative to it. */
  readonly within?: string;
  /** In bytes; an Attachment's limit when not given. */
  readonly sizeLimit?: number;
}

/** The files in the Tasks' worktrees, for what an Agent hands The Office there. */
export abstract class WorktreeFiles {
  /** Throws AttachmentRefused, with the reason, for a file it may not read. */
  abstract read(worktree: string, path: string, limits?: WorktreeFileLimits): Promise<WorktreeFile>;
}
