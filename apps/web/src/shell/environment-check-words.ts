import type { EnvironmentCheckState } from "@the-office/contracts";
import type { Tone } from "./tone-words.ts";

/** How an environment check stands, as its badge says it. */
export const ENVIRONMENT_CHECK_STATE_WORDS: Readonly<
  Record<EnvironmentCheckState, { readonly tone: Tone; readonly label: string }>
> = {
  running: { tone: "info", label: "Checking" },
  passed: { tone: "success", label: "Ready" },
  failed: { tone: "danger", label: "Failed" },
  stopped: { tone: "warning", label: "Stopped" },
};
