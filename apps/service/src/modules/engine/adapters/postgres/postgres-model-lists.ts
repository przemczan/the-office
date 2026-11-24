import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EngineId } from "../../domain/engines.js";
import type { EngineModelList } from "../../domain/model-lists.js";
import { ModelListRepository } from "../../ports/model-list-repository.js";
import { engineModelLists } from "./model-lists.schema.js";

@Injectable()
export class PostgresModelLists extends ModelListRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async all(): Promise<readonly EngineModelList[]> {
    const rows = await this.database.select().from(engineModelLists);
    // A row this release can't read (no model in it) is as good as none: the fixed list stands.
    return rows.flatMap(({ engineId, models, listedAt }) =>
      Array.isArray(models) && models.length > 0 ? [{ engineId, models, listedAt }] : [],
    );
  }

  async save({ engineId, models, listedAt }: EngineModelList): Promise<void> {
    const kept = { models: [...models], listedAt };
    await this.database
      .insert(engineModelLists)
      .values({ engineId, ...kept })
      .onConflictDoUpdate({ target: engineModelLists.engineId, set: kept });
  }

  async remove(engineId: EngineId): Promise<void> {
    await this.database.delete(engineModelLists).where(eq(engineModelLists.engineId, engineId));
  }
}
