import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EngineId } from "../../domain/engines.js";
import type { WindowStartRecord, WindowStartSettings } from "../../domain/window-starts.js";
import {
  WindowStartRepository,
  type KeptWindowStart,
} from "../../ports/window-start-repository.js";
import { engineWindowStarts } from "./window-starts.schema.js";

type WindowStartRow = typeof engineWindowStarts.$inferSelect;

@Injectable()
export class PostgresWindowStarts extends WindowStartRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async all(): Promise<readonly KeptWindowStart[]> {
    return (await this.database.select().from(engineWindowStarts)).map(keptOf);
  }

  async of(engineId: EngineId): Promise<KeptWindowStart | undefined> {
    const [row] = await this.database
      .select()
      .from(engineWindowStarts)
      .where(eq(engineWindowStarts.engineId, engineId));
    return row && keptOf(row);
  }

  async saveSettings(engineId: EngineId, settings: WindowStartSettings): Promise<void> {
    const kept = {
      startAtTimes: [...settings.startAtTimes],
      startAfterReset: settings.startAfterReset,
    };
    await this.database
      .insert(engineWindowStarts)
      .values({ engineId, ...kept })
      .onConflictDoUpdate({ target: engineWindowStarts.engineId, set: kept });
  }

  async record(engineId: EngineId, record: WindowStartRecord): Promise<void> {
    const last = recordColumnsOf(record);
    await this.database
      .insert(engineWindowStarts)
      .values({ engineId, ...last })
      .onConflictDoUpdate({ target: engineWindowStarts.engineId, set: last });
  }
}

function recordColumnsOf(record: WindowStartRecord) {
  return {
    lastAt: record.at,
    lastOutcome: record.outcome,
    lastTrigger: record.trigger,
    lastReason: record.outcome === "skipped" ? record.reason : null,
    lastError: record.outcome === "failed" ? record.error : null,
    lastFiveHourResetsAt: record.outcome === "started" ? (record.fiveHourResetsAt ?? null) : null,
  };
}

function keptOf(row: WindowStartRow): KeptWindowStart {
  return {
    engineId: row.engineId,
    startAtTimes: row.startAtTimes,
    startAfterReset: row.startAfterReset,
    last: recordOf(row),
  };
}

/** The last record, or undefined while the row holds none, or one this release can't read. */
function recordOf({
  lastAt: at,
  lastOutcome,
  lastTrigger: trigger,
  lastReason,
  lastError,
  lastFiveHourResetsAt,
}: WindowStartRow): WindowStartRecord | undefined {
  if (at === null || trigger === null) return undefined;
  switch (lastOutcome) {
    case "started":
      return {
        at,
        outcome: lastOutcome,
        trigger,
        fiveHourResetsAt: lastFiveHourResetsAt ?? undefined,
      };
    case "skipped":
      return lastReason === null
        ? undefined
        : { at, outcome: lastOutcome, trigger, reason: lastReason };
    case "failed":
      return { at, outcome: lastOutcome, trigger, error: lastError ?? "" };
    default:
      return undefined;
  }
}
