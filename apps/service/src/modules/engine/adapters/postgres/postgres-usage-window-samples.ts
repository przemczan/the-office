import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EngineId } from "../../domain/engines.js";
import type { UsageWindowSample } from "../../domain/usage-window-samples.js";
import { UsageWindowSampleRepository } from "../../ports/usage-window-sample-repository.js";
import { usageWindowSamples } from "./usage-window-samples.schema.js";

@Injectable()
export class PostgresUsageWindowSamples extends UsageWindowSampleRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(engineId: EngineId, sample: UsageWindowSample, kept: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(usageWindowSamples).values({
        engineId,
        readAt: sample.readAt,
        tokens: sample.tokens,
        fiveHour: sample.fiveHour ?? null,
        sevenDay: sample.sevenDay ?? null,
      });
      const latest = transaction
        .select({ id: usageWindowSamples.id })
        .from(usageWindowSamples)
        .where(eq(usageWindowSamples.engineId, engineId))
        .orderBy(desc(usageWindowSamples.readAt))
        .limit(kept);
      await transaction
        .delete(usageWindowSamples)
        .where(
          and(eq(usageWindowSamples.engineId, engineId), notInArray(usageWindowSamples.id, latest)),
        );
    });
  }

  async latest(engineId: EngineId, limit: number): Promise<readonly UsageWindowSample[]> {
    const rows = await this.database
      .select()
      .from(usageWindowSamples)
      .where(eq(usageWindowSamples.engineId, engineId))
      .orderBy(desc(usageWindowSamples.readAt))
      .limit(limit);
    return rows.map(({ readAt, tokens, fiveHour, sevenDay }) => ({
      readAt,
      tokens,
      fiveHour: fiveHour ?? undefined,
      sevenDay: sevenDay ?? undefined,
    }));
  }

  async forget(engineId: EngineId): Promise<void> {
    await this.database.delete(usageWindowSamples).where(eq(usageWindowSamples.engineId, engineId));
  }
}
