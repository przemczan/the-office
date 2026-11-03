/** The steps of an Office update the launcher runs, as a failed one names where it stopped. */
export type OfficeUpdateStep = "fetch" | "merge" | "install" | "build";

/** How the last Office update ended, as the launcher left it in `result.json`. */
export type OfficeUpdateResult =
  | {
      readonly outcome: "updated";
      readonly from: string;
      readonly to: string;
      readonly finishedAt: Date;
    }
  | {
      readonly outcome: "failed";
      readonly from: string;
      readonly to: string;
      readonly failedStep: OfficeUpdateStep;
      readonly finishedAt: Date;
    };

const STEP_WORDS: Readonly<Record<OfficeUpdateStep, string>> = {
  fetch: "fetching the newest commits",
  merge: "moving to the newest commit",
  install: "installing (npm ci)",
  build: "the build",
};

/** The step, in the words a Notification and Settings › Updates use. */
export function stepWords(step: OfficeUpdateStep): string {
  return STEP_WORDS[step];
}
