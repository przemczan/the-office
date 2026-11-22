import type { CiRunStatus } from "@the-office/contracts";
import type { ToneWords } from "./tone-words.ts";

/** A CI run's status as the Status column shows it. */
export const CI_RUN_STATUS_WORDS: Readonly<Record<CiRunStatus, ToneWords>> = {
  queued: { label: "Queued", tone: "neutral", title: "It is waiting for a runner to pick it up." },
  waiting: {
    label: "Waiting",
    tone: "warning",
    title: "It is waiting, such as for an approval or another run.",
  },
  running: { label: "Running", tone: "info", title: "It is running now." },
  succeeded: { label: "Succeeded", tone: "success", title: "Every job passed." },
  failed: { label: "Failed", tone: "danger", title: "At least one job failed." },
  cancelled: { label: "Cancelled", tone: "neutral", title: "It was cancelled before it ended." },
  skipped: { label: "Skipped", tone: "neutral", title: "It was skipped and didn't run." },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    title: "The code host's status isn't one The Office knows.",
  },
};
