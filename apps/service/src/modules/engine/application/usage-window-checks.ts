import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import { EngineRefused } from "../domain/engine-refused.js";
import type { Engine } from "../domain/engines.js";
import { AgentEngines } from "./agent-engines.js";
import { EngineModels } from "./engine-models.js";
import { UsageWindowReadings } from "./usage-window-readings.js";

/** How long The Office waits after each check of the engines' usage windows (spec §5.4). */
export const USAGE_WINDOW_CHECK_EVERY = 5 * 60 * 1000;

export const USAGE_WINDOW_CHECK = "The check of the engines' usage windows";

/**
 * Reads the usage windows of each listed engine that has them as the service starts and every 5
 * minutes (spec §5.4), with no session, so a used-up window found free again is known while every
 * Task on its engine is paused. One engine at a time and one check at a time; a failed read is
 * logged and the next engine is read. A test instance of The Office (`OFFICE_TEST_INSTANCE`)
 * schedules none, and a check asked of it is refused with EngineRefused.
 */
@Injectable()
export class UsageWindowChecks implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(UsageWindowChecks.name);
  /** Ends a read under way as the service stops, before the schedule waits for the check. */
  private readonly stopping = new AbortController();

  constructor(
    private readonly engines: AgentEngines,
    private readonly engineModels: EngineModels,
    private readonly readings: UsageWindowReadings,
    private readonly schedule: Schedule,
    @Optional() private readonly testInstance: OfficeTestInstance = OfficeTestInstance.OFF,
  ) {}

  /** After every module is up, so whoever listens to a reading hears the first. */
  onApplicationBootstrap(): void {
    if (this.testInstance.on) return;
    this.schedule.every(USAGE_WINDOW_CHECK, USAGE_WINDOW_CHECK_EVERY, () => this.check());
  }

  onModuleDestroy(): void {
    this.stopping.abort(new Error("The service is stopping."));
  }

  async check(): Promise<void> {
    if (this.testInstance.on) throw new EngineRefused();
    for (const engine of await this.engineModels.engines()) {
      if (this.stopping.signal.aborted) return;
      if (this.engines.readsUsageWindows(engine)) await this.read(engine);
    }
  }

  private async read(engine: Engine): Promise<void> {
    try {
      const windows = await this.engines.of(engine).readUsageWindows(engine, this.stopping.signal);
      if (windows !== undefined) await this.readings.keep(engine, windows);
    } catch (error) {
      this.logger.warn(
        `Reading the usage windows of the engine ${engine.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
