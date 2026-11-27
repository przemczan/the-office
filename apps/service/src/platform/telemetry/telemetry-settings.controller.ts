import {
  Body,
  ConflictException,
  Controller,
  Get,
  Put,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  telemetryChoiceSchema,
  type TelemetryChoice,
  type TelemetrySettings,
} from "@the-office/contracts";
import { ContractPipe } from "../http/contract-pipe.js";
import { BundledGrafanaKeeper } from "./bundled-grafana/bundled-grafana-keeper.js";
import { SavedTelemetrySetting } from "./saved-telemetry-setting.js";
import { choiceToSave } from "./telemetry-choice.js";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import { TelemetrySettingsView } from "./telemetry-settings-view.js";
import { isSetByEnvironment } from "./telemetry-settings.js";

const SET_BY_ENVIRONMENT =
  "The environment sets telemetry (the OTEL_ variables in .env), so it can't be changed here.";

/**
 * Settings › Telemetry: where The Office exports from its next start, and the bundled Grafana,
 * started at once when chosen (its Try again is an Office action of Telemetry). The headers'
 * values never leave the service.
 */
@Controller("settings/telemetry")
export class TelemetrySettingsController {
  constructor(
    private readonly saved: SavedTelemetrySetting,
    private readonly running: RunningTelemetrySettings,
    private readonly bundledGrafana: BundledGrafanaKeeper,
    private readonly view: TelemetrySettingsView,
  ) {}

  @Get()
  async settings(): Promise<TelemetrySettings> {
    return this.answer(await this.saved.read());
  }

  /**
   * Saves the choice for the next start, starting the bundled Grafana at once when it is chosen, so
   * it is ready by then; refused while the environment sets telemetry.
   */
  @Put()
  async save(
    @Body(new ContractPipe(telemetryChoiceSchema)) sent: TelemetryChoice,
  ): Promise<TelemetrySettings> {
    this.refuseWhileSetByEnvironment();
    let kept: TelemetryChoice | undefined;
    await this.saved.change((saved) => {
      const checked = choiceToSave(sent, saved);
      if (checked.problems) {
        throw new UnprocessableEntityException({
          message: checked.problems.join(" "),
          reasons: checked.problems,
        });
      }
      kept = checked.choice;
      return checked.choice;
    });
    if (kept?.kind === "bundled-grafana") void this.bundledGrafana.start();
    return this.answer(kept);
  }

  private refuseWhileSetByEnvironment(): void {
    if (isSetByEnvironment(this.running.inEffect)) {
      throw new ConflictException({ message: SET_BY_ENVIRONMENT, reasons: [SET_BY_ENVIRONMENT] });
    }
  }

  private answer(saved: TelemetryChoice | undefined): Promise<TelemetrySettings> {
    return this.view.of(saved);
  }
}
