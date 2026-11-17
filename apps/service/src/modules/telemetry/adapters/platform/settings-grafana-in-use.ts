import { Injectable } from "@nestjs/common";
import { BundledGrafanaKeeper } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana-keeper.js";
import { BUNDLED_GRAFANA_READ_ADDRESS } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana.js";
import { SavedTelemetrySetting } from "../../../../platform/telemetry/saved-telemetry-setting.js";
import { RunningTelemetrySettings } from "../../../../platform/telemetry/telemetry-in-effect.js";
import { isSetByEnvironment } from "../../../../platform/telemetry/telemetry-settings.js";
import { GrafanaInUse, type GrafanaNow } from "../../ports/grafana-in-use.js";

/**
 * The Grafana Settings › Telemetry chooses, read afresh on each request so a saved read address
 * applies at once: none while telemetry is set by the environment; the bundled one while Bundled
 * Grafana is saved, as its keeper tells, read at its read address with no token; the user's own
 * while their endpoint is saved with a Grafana read address, read with its read token.
 */
@Injectable()
export class SettingsGrafanaInUse extends GrafanaInUse {
  constructor(
    private readonly saved: SavedTelemetrySetting,
    private readonly keeper: BundledGrafanaKeeper,
    private readonly running: RunningTelemetrySettings,
  ) {
    super();
  }

  async now(): Promise<GrafanaNow> {
    if (isSetByEnvironment(this.running.inEffect)) return { kind: "none" };
    const saved = await this.saved.read();
    if (saved?.kind === "own-endpoint") {
      if (!saved.grafana) return { kind: "none" };
      const { readAddress, readToken } = saved.grafana;
      return {
        kind: "ready",
        access: { address: readAddress, ...(readToken && { token: readToken }) },
      };
    }
    const status = await this.keeper.status(saved);
    const address = BUNDLED_GRAFANA_READ_ADDRESS;
    switch (status.state) {
      case "not-wanted":
        return { kind: "none" };
      case "starting":
        return { kind: "starting", address };
      case "failed":
        return { kind: "failed", address, problem: status.problem ?? "" };
      case "running":
        return { kind: "ready", access: { address } };
    }
  }

  async savedReadToken(): Promise<string | undefined> {
    const saved = await this.saved.read();
    return saved?.kind === "own-endpoint" ? (saved.grafana?.readToken ?? undefined) : undefined;
  }
}
