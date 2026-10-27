export class MemoryNoteNotFound extends Error {
  constructor(readonly noteId: string) {
    super(`There is no Memory note "${noteId}".`);
    this.name = "MemoryNoteNotFound";
  }
}
