import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { CodexApiKey } from "../../domain/codex-api-key.js";
import { FIRST_OFFICE_DEFAULT, type EngineSettings } from "../../domain/engine-settings.js";
import type { Engine, EngineId, EngineModel } from "../../domain/engines.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { engines, engineSettings, modelPrices } from "./engine-settings.schema.js";

type EngineRow = typeof engines.$inferSelect;
type EngineSettingsRow = typeof engineSettings.$inferSelect;

@Injectable()
export class PostgresEngineSettings extends EngineSettingsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<EngineSettings> {
    const rows = await this.database.select().from(engines).orderBy(asc(engines.position));
    const [row] = await this.database.select().from(engineSettings).limit(1);
    const prices = await this.database
      .select()
      .from(modelPrices)
      // The Claude models first, as Settings › Engines lists them.
      .orderBy(sql`${modelPrices.engineId} ASC NULLS FIRST`, asc(modelPrices.model));
    const searchEndpointUrl = row?.searchEndpointUrl ?? null;
    return {
      engines: rows.map(engineOf),
      officeDefault: row ? officeDefaultOf(row) : FIRST_OFFICE_DEFAULT,
      searchEndpoint: searchEndpointUrl === null ? null : { baseUrl: searchEndpointUrl },
      modelPrices: prices.map(({ engineId, model, ...price }) => ({ engineId, model, price })),
    };
  }

  async replace({
    engines: listed,
    officeDefault,
    searchEndpoint,
    modelPrices: priced,
  }: EngineSettings): Promise<void> {
    const settingsRow = {
      searchEndpointUrl: searchEndpoint?.baseUrl ?? null,
      officeDefaultEngineId: officeDefault?.engineId ?? null,
      officeDefaultModel: officeDefault?.model ?? null,
    };
    await this.database.transaction(async (transaction) => {
      await transaction.delete(engines);
      if (listed.length > 0) await transaction.insert(engines).values(listed.map(engineRowOf));
      await transaction
        .insert(engineSettings)
        .values(settingsRow)
        .onConflictDoUpdate({ target: engineSettings.id, set: settingsRow });
      await transaction.delete(modelPrices);
      if (priced.length > 0) {
        await transaction
          .insert(modelPrices)
          .values(priced.map(({ engineId, model, price }) => ({ engineId, model, ...price })));
      }
    });
  }

  async setCodexApiKey(engineId: EngineId, key: CodexApiKey | null): Promise<void> {
    await this.database
      .update(engines)
      .set({ key: key?.reveal() ?? null })
      .where(and(eq(engines.id, engineId), eq(engines.kind, "codex")));
  }
}

function officeDefaultOf({
  officeDefaultEngineId: engineId,
  officeDefaultModel: model,
}: EngineSettingsRow): EngineModel | null {
  return engineId === null || model === null ? null : { engineId, model };
}

function engineOf({
  id,
  name,
  kind,
  defaultModel,
  claudeCodeP,
  baseUrl,
  key,
  models,
}: EngineRow): Engine {
  if (kind === "claude-code") return { id, name, kind, defaultModel, claudeCodeP };
  if (kind === "codex") {
    return { id, name, kind, defaultModel, apiKey: key === null ? null : CodexApiKey.of(key) };
  }
  return {
    id,
    name,
    kind,
    defaultModel,
    baseUrl: baseUrl ?? "",
    key: key ?? "",
    models: models ?? [],
  };
}

function engineRowOf(engine: Engine, position: number): EngineRow {
  const { id, name, kind, defaultModel } = engine;
  const common = { id, position, name, kind, defaultModel };
  switch (engine.kind) {
    case "claude-code":
      return { ...common, claudeCodeP: engine.claudeCodeP, baseUrl: null, key: null, models: null };
    case "codex":
      return {
        ...common,
        claudeCodeP: false,
        baseUrl: null,
        key: engine.apiKey?.reveal() ?? null,
        models: null,
      };
    case "openai-compatible-api":
      return {
        ...common,
        claudeCodeP: false,
        baseUrl: engine.baseUrl,
        key: engine.key,
        models: engine.models,
      };
  }
}
