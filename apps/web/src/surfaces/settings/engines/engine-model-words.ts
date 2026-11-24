import { clockOf, dayAndClockOf, sameDay } from "../../../shell/time.ts";

/**
 * When an engine's account last listed its models: "Models listed at 14:02" today, "Models listed
 * 25 Oct, 14:02" before; while its type's fixed list stands in, that it does.
 */
export function modelsListedWords(listedAt: string | null, now: Date = new Date()): string {
  if (listedAt === null) return "Models: the built-in list, until the engine answers.";
  return sameDay(listedAt, now)
    ? `Models listed at ${clockOf(listedAt)}`
    : `Models listed ${dayAndClockOf(listedAt, now)}`;
}
