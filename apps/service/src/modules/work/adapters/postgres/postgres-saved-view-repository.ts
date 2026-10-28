import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { SavedView } from "../../domain/saved-view.js";
import { SavedViewRepository } from "../../ports/saved-view-repository.js";
import { savedViews } from "./saved-views.schema.js";

@Injectable()
export class PostgresSavedViewRepository extends SavedViewRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(savedView: SavedView): Promise<void> {
    await this.database.insert(savedViews).values(savedView);
  }

  async list(): Promise<readonly SavedView[]> {
    return this.database
      .select()
      .from(savedViews)
      .orderBy(asc(savedViews.savedAt), asc(savedViews.id));
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.database
      .delete(savedViews)
      .where(eq(savedViews.id, id))
      .returning({ id: savedViews.id });
    return removed.length > 0;
  }
}
