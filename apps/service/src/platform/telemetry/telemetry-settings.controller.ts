import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Put,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  telemetryChoiceSchema,
  type TelemetryChoice,
  type TelemetrySettings,
} from "@the-office/contracts";
import { ContractPipe } from "../http/contract-pipe.js";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { choiceToSave, savedChoiceOf } from "./telemetry-choice.js";
import { readTelemetryFile, telemetryFilePath, writeTelemetryFile } from "./telemetry-file.js";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import {
  isSetByEnvironment,
  runningTelemetryOf,
  sameTelemetry,
  telemetrySettingsFrom,
} from "./telemetry-settings.js";

const SET_BY_ENVIRONMENT =
  "The environment sets telemetry (the OTEL_ variables in .env), so it can't be changed here.";

/** The telemetry setting's file in the Office data directory, written one save at a time. */
@Injectable()
export class SavedTelemetrySetting {
  private readonly path: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(officeData: OfficeDataDirectory) {
    this.path = telemetryFilePath(officeData.path);
  }

  async read(): Promise<TelemetryChoice | undefined> {
    return (await readTelemetryFile(this.path)).choice;
  }

  /** Runs `change` on the saved choice, alone, saving what it answers unless it throws. */
  change(change: (saved: TelemetryChoice | undefined) => TelemetryChoice): Promise<void> {
    const changed = this.writes.then(async () =>
      writeTelemetryFile(this.path, change(await this.read())),
    );
    this.writes = changed.catch(() => undefined);
    return changed;
  }
}

/**
 * Settings › Telemetry: where The Office exports from its next start. The headers' values
 * never leave the service.
 */
@Controller("settings/telemetry")
export class TelemetrySettingsController {
  constructor(
    private readonly saved: SavedTelemetrySetting,
    private readonly running: RunningTelemetrySettings,
  ) {}

  @Get()
  async settings(): Promise<TelemetrySettings> {
    return this.answer(await this.saved.read());
  }

  /** Saves the choice for the next start; refused while the environment sets telemetry. */
  @Put()
  async save(
    @Body(new ContractPipe(telemetryChoiceSchema)) sent: TelemetryChoice,
  ): Promise<TelemetrySettings> {
    if (isSetByEnvironment(this.running.inEffect)) {
      throw new ConflictException({ message: SET_BY_ENVIRONMENT, reasons: [SET_BY_ENVIRONMENT] });
    }
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
    return this.answer(kept);
  }

  private answer(saved: TelemetryChoice | undefined): TelemetrySettings {
    const inEffect = this.running.inEffect;
    const setByEnvironment = isSetByEnvironment(inEffect);
    return {
      saved: savedChoiceOf(saved),
      running: runningTelemetryOf(inEffect),
      setByEnvironment,
      appliesAtNextStart:
        !setByEnvironment && !sameTelemetry(telemetrySettingsFrom(saved, {}), inEffect),
    };
  }
}
