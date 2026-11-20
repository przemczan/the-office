import { Module } from "@nestjs/common";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { BundledGrafana } from "./bundled-grafana/bundled-grafana.js";
import { BundledGrafanaKeeper } from "./bundled-grafana/bundled-grafana-keeper.js";
import { DockerComposeBundledGrafana } from "./bundled-grafana/docker-compose-bundled-grafana.js";
import { SavedTelemetrySetting } from "./saved-telemetry-setting.js";
import { TelemetrySettingsController } from "./telemetry-settings.controller.js";

/**
 * The telemetry setting over HTTP, for Settings › Telemetry and the First-run setup, and the
 * bundled Grafana it starts. Apart from `TelemetryModule`, which every module's tests import, so
 * only the app serves the routes and needs the Office data directory for them. A test overrides
 * `BundledGrafana` with `ScriptedBundledGrafana`. Stats reads the saved choice and the keeper's
 * status for the full stats.
 */
@Module({
  providers: [
    SavedTelemetrySetting,
    BundledGrafanaKeeper,
    {
      provide: BundledGrafana,
      useFactory: (officeData: OfficeDataDirectory) =>
        new DockerComposeBundledGrafana(officeData.folder("grafana")),
      inject: [OfficeDataDirectory],
    },
  ],
  controllers: [TelemetrySettingsController],
  exports: [BundledGrafanaKeeper, SavedTelemetrySetting],
})
export class TelemetryHttpModule {}
