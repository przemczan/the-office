/**
 * The steps of an Office update, as a failed one names where it stopped: a checkout's, which the
 * launcher runs with git and npm, and a release's or a container's, from the download to the start.
 */
export type OfficeUpdateStep =
  "fetch" | "merge" | "install" | "build" | "download" | "verify" | "unpack" | "switch" | "start";

/**
 * How the last Office update ended, as the launcher or the Office updater left it in `result.json`:
 * `from` and `to` are commits for a checkout, versions for a release or a container.
 */
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
      /** Going back to `from` failed too. */
      readonly rollbackFailed?: true;
      readonly finishedAt: Date;
    };

const STEP_WORDS: Readonly<Record<OfficeUpdateStep, string>> = {
  fetch: "fetching the newest commits",
  merge: "moving to the newest commit",
  install: "installing (npm ci)",
  build: "the build",
  download: "downloading the new version",
  verify: "checking the download",
  unpack: "unpacking the new version",
  switch: "switching to the new version",
  start: "starting the new version",
};

/** The step, in the words a Notification and Settings › Updates use. */
export function stepWords(step: OfficeUpdateStep): string {
  return STEP_WORDS[step];
}
