import type { Publication, PullRequestText } from "../domain/publish.js";
import type { PublishTarget } from "../domain/stage.js";

/**
 * Publish by the Project's publishing mode (spec §9), or push the branch only as a Publish Stage's
 * target may say (spec §2.3), which Projects runs with The Office's own git and the user's
 * credentials, out of every Agent's reach; the composition root binds it.
 */
export abstract class TaskPublishing {
  abstract publish(
    projectId: string,
    taskId: string,
    text: PullRequestText,
    target: PublishTarget,
  ): Promise<Publication>;
}
