import { Injectable } from "@nestjs/common";

/** The titles of the Tasks there are, by their ids; a Task that is gone is left out. */
export interface MemoryTaskTitleSource {
  titlesOf(taskIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * Where the module keeping Tasks gives People the titles of the Tasks Memory notes were written
 * on, which the Memory tab names them by. That module calls People (its `KnownPeople`), so it
 * registers here as it starts instead of being called through a port.
 */
@Injectable()
export class MemoryTaskTitles implements MemoryTaskTitleSource {
  private source: MemoryTaskTitleSource | undefined;

  provide(source: MemoryTaskTitleSource): void {
    if (this.source) throw new Error("Tasks' titles come from one module only.");
    this.source = source;
  }

  /** Asks nobody for no Tasks. */
  async titlesOf(taskIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (taskIds.length === 0) return new Map();
    if (!this.source) throw new Error("No module gives Tasks' titles.");
    return this.source.titlesOf(taskIds);
  }
}
