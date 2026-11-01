import { Inject, Injectable } from "@nestjs/common";
import { asc } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EngineSettings } from "../../domain/engine-settings.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { apiEndpoints, engineSettings, modelPrices } from "./engine-settings.schema.js";

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
    const prices = await this.database
      .select()
      .from(modelPrices)
      .orderBy(asc(modelPrices.engineId), asc(modelPrices.model));
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
      modelPrices: prices.map(({ engineId, model, ...price }) => ({ engineId, model, price })),
    };
  }

  async replace({
    apiEndpoints: endpoints,
    searchEndpoint,
    modelPrices: priced,
  }: EngineSettings): Promise<void> {
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
      await transaction.delete(modelPrices);
      if (priced.length > 0) {
        await transaction
          .insert(modelPrices)
          .values(priced.map(({ engineId, model, price }) => ({ engineId, model, ...price })));
      }
    });
  }
}
