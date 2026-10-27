import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { MemoryNote } from "../../domain/memory-note.js";
import { MemoryRepository } from "../../ports/memory-repository.js";
import { memoryNotes } from "./memory.schema.js";

type MemoryNoteRow = typeof memoryNotes.$inferSelect;

@Injectable()
export class PostgresMemoryRepository extends MemoryRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async append(note: MemoryNote): Promise<void> {
    await this.database.insert(memoryNotes).values({ ...note, projectId: note.projectId ?? null });
  }

  async list(roleKey: string): Promise<readonly MemoryNote[]> {
    const rows = await this.database
      .select()
      .from(memoryNotes)
      .where(eq(memoryNotes.roleKey, roleKey))
      .orderBy(desc(memoryNotes.writtenAt), desc(memoryNotes.id));
    return rows.map(toNote);
  }

  async remove(roleKey: string, noteId: string): Promise<boolean> {
    const removed = await this.database
      .delete(memoryNotes)
      .where(and(eq(memoryNotes.roleKey, roleKey), eq(memoryNotes.id, noteId)))
      .returning({ id: memoryNotes.id });
    return removed.length > 0;
  }

  async clear(roleKey: string): Promise<void> {
    await this.database.delete(memoryNotes).where(eq(memoryNotes.roleKey, roleKey));
  }
}

function toNote(row: MemoryNoteRow): MemoryNote {
  return { ...row, projectId: row.projectId ?? undefined };
}
