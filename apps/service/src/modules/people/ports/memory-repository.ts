import type { MemoryNote } from "../domain/memory-note.js";

/** Where Memory notes are kept. Notes are added and deleted, never changed. */
export abstract class MemoryRepository {
  abstract append(note: MemoryNote): Promise<void>;

  /** The person's notes, newest first. */
  abstract list(roleKey: string): Promise<readonly MemoryNote[]>;

  /** False when the person has no such note. */
  abstract remove(roleKey: string, noteId: string): Promise<boolean>;

  abstract clear(roleKey: string): Promise<void>;
}
