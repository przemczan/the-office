/** A Usage window as last read. */
export interface StatsUsageWindow {
  /** From 0 to 100. */
  readonly percentUsed: number;
  /** Undefined while the window has not begun. */
  readonly resetsAt: Date | undefined;
}

/**
 * An engine's Usage windows now: `none` for an engine without them, `not-read` while they aren't
 * read yet, `read` with the latest reading.
 */
export type StatsEngineWindows =
  | { readonly state: "none" }
  | { readonly state: "not-read" }
  | {
      readonly state: "read";
      readonly fiveHour: StatsUsageWindow;
      readonly sevenDay: StatsUsageWindow;
      readonly readAt: Date;
    };

export interface StatsEngine {
  readonly engineId: string;
  readonly name: string;
  readonly windows: StatsEngineWindows;
}

/** Every engine with its Usage windows now, as the Engine keeps them; the composition root binds it. */
export abstract class EngineWindows {
  /** In Settings › Engines' order. */
  abstract list(): Promise<readonly StatsEngine[]>;
}
