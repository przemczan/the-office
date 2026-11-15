import { Module } from "@nestjs/common";
import {
  SavedTelemetrySetting,
  TelemetrySettingsController,
} from "./telemetry-settings.controller.js";

/**
 * The telemetry setting over HTTP, for Settings › Telemetry and the First-run setup. Apart from
 * `TelemetryModule`, which every module's tests import, so only the app serves the routes and
 * needs the Office data directory for them.
 */
@Module({ providers: [SavedTelemetrySetting], controllers: [TelemetrySettingsController] })
export class TelemetryHttpModule {}
