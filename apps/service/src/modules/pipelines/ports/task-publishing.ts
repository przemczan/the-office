import type { Publication, PullRequestText } from "../domain/publish.js";

/**
 * Publish by the Project's publishing mode (spec §9), which Projects runs with The Office's own
 * git and the user's credentials, out of every Agent's reach; the composition root binds it.
 */
export abstract class TaskPublishing {
  abstract publish(projectId: string, taskId: string, text: PullRequestText): Promise<Publication>;
}
