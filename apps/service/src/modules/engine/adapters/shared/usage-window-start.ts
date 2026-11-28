import { hasUsageWindows, type Engine } from "../../domain/engines.js";

/** The one-line prompt of the turn that starts a 5-hour window, on every engine type. */
export const WINDOW_START_PROMPT = "Reply with OK.";

/** How a window start names itself in `EngineReadTimedOut`. */
export function windowStartWhat(engine: Engine): string {
  return `Starting the 5-hour window of the engine ${engine.id}`;
}

/** Refuses a start on an engine whose account has no usage windows, which would only cost tokens. */
export function requireUsageWindows(engine: Engine): void {
  if (!hasUsageWindows(engine)) {
    throw new Error(`The engine ${engine.id} has no usage windows to start.`);
  }
}
