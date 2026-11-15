import { Injectable } from "@nestjs/common";
import type { TelemetryChoice } from "@the-office/contracts";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { readTelemetryFile, telemetryFilePath, writeTelemetryFile } from "./telemetry-file.js";

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
