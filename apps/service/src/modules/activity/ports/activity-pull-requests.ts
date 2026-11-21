import type { ActivityPullRequest } from "../domain/activity.js";

/** The open pull requests The Office opened, which Projects keeps; the composition root binds it. */
export abstract class ActivityPullRequests {
  abstract list(): Promise<{ readonly pullRequests: readonly ActivityPullRequest[] }>;
}
