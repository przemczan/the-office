import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TestInstanceSettingsChanged } from "../domain/test-instance-events.js";
import { TestInstanceRefused } from "../domain/test-instance-refused.js";
import { settingsProblems, type TestInstanceSettings } from "../domain/test-instance-settings.js";
import { TestInstanceSettingsStore } from "../ports/test-instance-settings-store.js";

/** The port The Office itself listens on, which no Proxy port may be. */
export class OfficePort {
  constructor(readonly port: number) {}
}

/**
 * Settings › Office limits' Test instances card (spec §2.12, Defaults): Test instances at once,
 * Idle time and the Proxy ports. The contract keeps the bounds; this keeps The Office's own port
 * out of the range.
 */
@Injectable()
export class TestInstanceLimits {
  constructor(
    private readonly store: TestInstanceSettingsStore,
    private readonly officePort: OfficePort,
    private readonly events: EventBus,
  ) {}

  read(): Promise<TestInstanceSettings> {
    return this.store.read();
  }

  /** Why the settings can't be kept beyond the contract's bounds, each naming its field. */
  problemsOf(settings: TestInstanceSettings): string[] {
    return settingsProblems(settings, this.officePort.port);
  }

  /** Keeps the settings whole; refused (TestInstanceRefused) naming the field. */
  async change(settings: TestInstanceSettings): Promise<TestInstanceSettings> {
    const problems = this.problemsOf(settings);
    if (problems.length > 0) throw new TestInstanceRefused(problems);
    await this.store.change(settings);
    await this.events.publish(new TestInstanceSettingsChanged());
    return this.store.read();
  }
}
