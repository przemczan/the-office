import type { ActivityOnboarding } from "../domain/activity.js";

/** Each Project's onboarding, from its Onboard Task, which Work keeps; the composition root binds it. */
export abstract class ActivityOnboardings {
  abstract list(): Promise<readonly ActivityOnboarding[]>;
}
