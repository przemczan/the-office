import { Injectable } from "@nestjs/common";
import { hasUsageWindows, type EngineId } from "../domain/engines.js";
import type { UsageWindow } from "../domain/usage-windows.js";
import { EngineModels } from "./engine-models.js";
import { UsageWindowState } from "./usage-window-state.js";

/**
 * An engine's Usage windows now: `none` for an engine without them, `not-read` while they aren't
 * read yet, `read` with the latest reading.
 */
export type EngineWindowsNow =
  | { readonly state: "none" }
  | { readonly state: "not-read" }
  | {
      readonly state: "read";
      readonly fiveHour: UsageWindow;
      readonly sevenDay: UsageWindow;
      readonly readAt: Date;
    };

export interface EngineUsageWindowsNow {
  readonly engineId: EngineId;
  readonly name: string;
  readonly windows: EngineWindowsNow;
}

/** Every engine listed, in Settings › Engines' order, with its Usage windows as last read. */
@Injectable()
export class UsageWindowsNow {
  constructor(
    private readonly models: EngineModels,
    private readonly state: UsageWindowState,
  ) {}

  async list(): Promise<readonly EngineUsageWindowsNow[]> {
    return (await this.models.engines()).map((engine) => ({
      engineId: engine.id,
      name: engine.name,
      windows: this.windowsOf(hasUsageWindows(engine), engine.id),
    }));
  }

  private windowsOf(withWindows: boolean, engineId: EngineId): EngineWindowsNow {
    if (!withWindows) return { state: "none" };
    const reading = this.state.of(engineId);
    if (reading === undefined) return { state: "not-read" };
    return {
      state: "read",
      fiveHour: reading.fiveHour,
      sevenDay: reading.sevenDay,
      readAt: reading.readAt,
    };
  }
}
