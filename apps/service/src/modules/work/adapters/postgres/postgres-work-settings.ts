import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DEFAULT_OFFICE_WIDE_LIMIT } from "../../domain/task-start.js";
import { DEFAULT_USAGE_MEASURES } from "../../domain/usage-estimate.js";
import type { EngineCaps, UsageSettings } from "../../domain/usage-settings.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { engineCaps, workSettings } from "./work-settings.schema.js";

type EngineCapsRow = typeof engineCaps.$inferSelect;

@Injectable()
export class PostgresWorkSettings extends WorkSettings {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async officeWideLimit(): Promise<number> {
    const [row] = await this.database.select().from(workSettings).limit(1);
    return row?.officeWideLimit ?? DEFAULT_OFFICE_WIDE_LIMIT;
  }

  async changeOfficeWideLimit(officeWideLimit: number): Promise<void> {
    await this.database
      .insert(workSettings)
      .values({ officeWideLimit })
      .onConflictDoUpdate({ target: workSettings.id, set: { officeWideLimit } });
  }

  async usageSettings(): Promise<UsageSettings> {
    const [row] = await this.database.select().from(workSettings).limit(1);
    const caps = await this.database.select().from(engineCaps);
    return {
      measures: row?.usageMeasures ?? DEFAULT_USAGE_MEASURES,
      caps: caps.map(engineCapsOf),
    };
  }

  async changeUsageSettings({ measures, caps }: UsageSettings): Promise<void> {
    const usageMeasures = [...measures];
    await this.database.transaction(async (transaction) => {
      await transaction
        .insert(workSettings)
        .values({ usageMeasures })
        .onConflictDoUpdate({ target: workSettings.id, set: { usageMeasures } });
      await transaction.delete(engineCaps);
      if (caps.length > 0) await transaction.insert(engineCaps).values(caps.map(engineCapsRowOf));
    });
  }
}

function engineCapsOf(row: EngineCapsRow): EngineCaps {
  return {
    engineId: row.engineId,
    // Whether the engine has windows is for `everyEngineCaps` to say, which knows the engines.
    windows: {
      fiveHour: row.fiveHourWindow ?? undefined,
      sevenDay: row.sevenDayWindow ?? undefined,
    },
    dailyTokens: row.dailyTokens ?? undefined,
    dailyDollars: row.dailyDollars ?? undefined,
  };
}

function engineCapsRowOf({
  engineId,
  windows,
  dailyTokens,
  dailyDollars,
}: EngineCaps): EngineCapsRow {
  return {
    engineId,
    fiveHourWindow: windows?.fiveHour ?? null,
    sevenDayWindow: windows?.sevenDay ?? null,
    dailyTokens: dailyTokens ?? null,
    dailyDollars: dailyDollars ?? null,
  };
}
