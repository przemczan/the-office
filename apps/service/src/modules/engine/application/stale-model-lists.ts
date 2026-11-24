import { Injectable } from "@nestjs/common";

/**
 * Asks, in the background, for the model lists grown stale whenever the engines' models are shown
 * (spec §5.4.5, "Models an engine lists"), for what reads them without the engines' adapters, such
 * as Settings › Engines. `EngineModelLists`, beside the adapters, registers how; until it does, as
 * in a test of the settings alone, nothing is asked.
 */
@Injectable()
export class StaleModelLists {
  private refreshStale: () => void = () => undefined;

  /** `refreshStale` starts the asking and never waits for it nor throws. */
  registerRefresh(refreshStale: () => void): void {
    this.refreshStale = refreshStale;
  }

  /** Starts asking for each stale list; never waits for the engines. */
  refreshInBackground(): void {
    this.refreshStale();
  }
}
