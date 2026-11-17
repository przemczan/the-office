import { Injectable } from "@nestjs/common";
import { BundledGrafanaKeeper } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana-keeper.js";
import { BUNDLED_GRAFANA_READ_ADDRESS } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana.js";
import { SavedTelemetrySetting } from "../../../../platform/telemetry/saved-telemetry-setting.js";
import { GrafanaInUse, type GrafanaNow } from "../../ports/grafana-in-use.js";

/**
 * The bundled Grafana, as Settings › Telemetry keeps it: in use while Bundled Grafana is saved and
 * telemetry isn't set by the environment (the keeper's `not-wanted` otherwise), read at its read
 * address, which asks no token.
 */
@Injectable()
export class BundledGrafanaInUse extends GrafanaInUse {
  constructor(
    private readonly saved: SavedTelemetrySetting,
    private readonly keeper: BundledGrafanaKeeper,
  ) {
    super();
  }

  async now(): Promise<GrafanaNow> {
    const status = await this.keeper.status(await this.saved.read());
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
}
