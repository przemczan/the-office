import { RoleRefused } from "./role-refused.js";

export const MEMORY_NOTE_LENGTH = 600;

/** Who wrote a Memory note: the user on the Memory tab, or an Agent in one of its Threads. */
export type MemoryNoteSource =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly threadId: string; readonly taskId: string | undefined };

/** One entry in a person's Memory. Never edited: it is written once, then deleted or kept. */
export interface MemoryNote {
  readonly id: string;
  readonly roleKey: string;
  /** The Project the note is about; undefined when it holds for all of them. */
  readonly projectId: string | undefined;
  readonly text: string;
  readonly source: MemoryNoteSource;
  readonly writtenAt: Date;
}

export interface MemoryNoteDraft {
  readonly roleKey: string;
  readonly projectId: string | undefined;
  readonly text: string;
  readonly source: MemoryNoteSource;
}

/** Refuses with every reason, in the UI's words, when the note is empty or too long. */
export function writeMemoryNote(draft: MemoryNoteDraft, id: string, writtenAt: Date): MemoryNote {
  const text = draft.text.trim();
  const problems: string[] = [];
  if (text === "") problems.push("Write what to remember.");
  if (text.length > MEMORY_NOTE_LENGTH) {
    problems.push(`Keep a note to ${MEMORY_NOTE_LENGTH} characters or fewer.`);
  }
  if (problems.length > 0) throw new RoleRefused(problems);
  return { ...draft, text, id, writtenAt };
}
