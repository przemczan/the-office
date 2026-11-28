import { Module } from "@nestjs/common";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { BundledGrafana } from "./bundled-grafana/bundled-grafana.js";
import { BundledGrafanaKeeper } from "./bundled-grafana/bundled-grafana-keeper.js";
import { DockerComposeBundledGrafana } from "./bundled-grafana/docker-compose-bundled-grafana.js";
import { SavedTelemetrySetting } from "./saved-telemetry-setting.js";
import { TelemetrySettingsView } from "./telemetry-settings-view.js";

/**
 * The saved telemetry setting, its view for Settings › Telemetry and the First-run setup, and the
 * bundled Grafana it starts. Apart from `TelemetryModule`, which every module's tests import, so
 * only the app needs the Office data directory for them. Telemetry's `StatsModule` serves the
 * setting's routes and reads the saved choice and the keeper's status for the full stats. A test
 * overrides `BundledGrafana` with `ScriptedBundledGrafana`.
 */
@Module({
  providers: [
    SavedTelemetrySetting,
    TelemetrySettingsView,
    BundledGrafanaKeeper,
    {
      provide: BundledGrafana,
      useFactory: (officeData: OfficeDataDirectory) =>
        new DockerComposeBundledGrafana(officeData.folder("grafana")),
      inject: [OfficeDataDirectory],
    },
  ],
  exports: [BundledGrafanaKeeper, SavedTelemetrySetting, TelemetrySettingsView],
})
export class TelemetrySettingModule {}
