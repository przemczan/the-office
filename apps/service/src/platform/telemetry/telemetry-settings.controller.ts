import { Controller, Get } from "@nestjs/common";
import type { TelemetrySettings } from "@the-office/contracts";
import { SavedTelemetrySetting } from "./saved-telemetry-setting.js";
import { TelemetrySettingsView } from "./telemetry-settings-view.js";

/**
 * Settings › Telemetry, read: where The Office exports from its next start, and the bundled
 * Grafana. Its Save and its bundled Grafana's Try again are Office actions of Telemetry. The
 * headers' values never leave the service.
 */
@Controller("settings/telemetry")
export class TelemetrySettingsController {
  constructor(
    private readonly saved: SavedTelemetrySetting,
    private readonly view: TelemetrySettingsView,
  ) {}

  @Get()
  async settings(): Promise<TelemetrySettings> {
    return this.view.of(await this.saved.read());
  }
}
