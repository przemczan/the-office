import type { OfficeUpdateResult, OfficeUpdateStep } from "@the-office/contracts";

const STEP_WORDS: Readonly<Record<OfficeUpdateStep, string>> = {
  fetch: "fetching the newest commits",
  merge: "moving to the newest commit",
  install: "installing (npm ci)",
  build: "the build",
};

const short = (commit: string): string => commit.slice(0, 7);

/** How the last Office update ended, as its card's title says it. */
export function lastResultWords(result: OfficeUpdateResult): string {
  return result.outcome === "updated"
    ? `The Office updated to ${short(result.to)}.`
    : `The Office's update failed at ${STEP_WORDS[result.failedStep]}; it is back on ${short(result.from)}.`;
}

/** "Waiting for 2 things", or that it goes ahead now. */
export function waitingWords(busy: number): string {
  if (busy === 0) return "Nothing is busy, so The Office is restarting for it.";
  return busy === 1 ? "Waiting for 1 thing:" : `Waiting for ${busy} things:`;
}
