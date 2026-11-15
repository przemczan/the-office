/** First-run setup's steps after the first user, in order, each skippable. */
export const FIRST_RUN_SETUP_STEPS = ["engine", "github", "telemetry"] as const;
export type FirstRunSetupStep = (typeof FIRST_RUN_SETUP_STEPS)[number];

/** Each step's name, as the step list and its heading show it. */
export const FIRST_RUN_SETUP_STEP_NAMES: Readonly<Record<FirstRunSetupStep, string>> = {
  engine: "Engine",
  github: "Sign in with GitHub",
  telemetry: "Telemetry",
};

/** The step `?step=` names, or undefined for none or an unknown one (the page then shows the first). */
export function firstRunSetupStepOf(value: unknown): FirstRunSetupStep | undefined {
  return FIRST_RUN_SETUP_STEPS.find((step) => step === value);
}

/** The step after `step`, or undefined after the last. */
export function stepAfter(step: FirstRunSetupStep): FirstRunSetupStep | undefined {
  return FIRST_RUN_SETUP_STEPS[FIRST_RUN_SETUP_STEPS.indexOf(step) + 1];
}
