import { momentWords } from "./time.ts";
import { useClock } from "./use-clock.ts";

/** Up to this long, the wait is counted down in seconds; longer, it names the time. */
const COUNTED_DOWN_MS = 60_000;

/**
 * When the next try is taken, once wrong tries cost a wait or a lockout (spec §2.10): "Try again
 * in 16 seconds" for a short wait, "Try again at 14:32" for a long one, with its day when not
 * today; undefined once the time has come.
 */
export function tryAgainWords(tryAgainAt: string, now: Date): string | undefined {
  const waitMs = new Date(tryAgainAt).getTime() - now.getTime();
  if (waitMs <= 0) return undefined;
  if (waitMs <= COUNTED_DOWN_MS) {
    const seconds = Math.ceil(waitMs / 1000);
    return `Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
  }
  return `Try again at ${momentWords(tryAgainAt, now)}.`;
}

/** When to try again, renewed every second while a wait runs; undefined with none. */
export function useTryAgainWords(tryAgainAt: string | undefined): string | undefined {
  const now = useClock(1000);
  return tryAgainAt === undefined ? undefined : tryAgainWords(tryAgainAt, now);
}
