import { Inject, Injectable } from "@nestjs/common";
import { asc } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EngineSettings } from "../../domain/engine-settings.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { apiEndpoints, engineSettings } from "./engine-settings.schema.js";

@Injectable()
export class PostgresEngineSettings extends EngineSettingsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<EngineSettings> {
    const endpoints = await this.database
      .select()
      .from(apiEndpoints)
      .orderBy(asc(apiEndpoints.position));
    const [row] = await this.database.select().from(engineSettings).limit(1);
    const searchEndpointUrl = row?.searchEndpointUrl ?? null;
    return {
      apiEndpoints: endpoints.map(({ id, name, baseUrl, key, models }) => ({
        id,
        name,
        baseUrl,
        key,
        models,
      })),
      searchEndpoint: searchEndpointUrl === null ? null : { baseUrl: searchEndpointUrl },
    };
  }

  async replace({ apiEndpoints: endpoints, searchEndpoint }: EngineSettings): Promise<void> {
    const searchEndpointUrl = searchEndpoint?.baseUrl ?? null;
    await this.database.transaction(async (transaction) => {
      await transaction.delete(apiEndpoints);
      if (endpoints.length > 0) {
        await transaction
          .insert(apiEndpoints)
          .values(endpoints.map((endpoint, position) => ({ ...endpoint, position })));
      }
      await transaction
        .insert(engineSettings)
        .values({ searchEndpointUrl })
        .onConflictDoUpdate({ target: engineSettings.id, set: { searchEndpointUrl } });
    });
  }
}
