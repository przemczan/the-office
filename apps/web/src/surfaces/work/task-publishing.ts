import {
  initiativeBranchOf,
  type Initiative,
  type Project,
  type Task,
} from "@the-office/contracts";
import { publishingLabel } from "../../shell/project-words.ts";
import { initiativePipelineIn, isPublishingTask } from "./initiative-words.ts";

/**
 * How the Task's Publish ships, in a Stage's words: by the Project's publishing mode, or by merge
 * into its Initiative's branch when the Initiative has a Pipeline in its Project (spec 2.3); a Publishing Task's
 * puts the Initiative's branch itself into the base branch by the publishing mode.
 */
export function taskPublishingWords(
  task: Pick<Task, "madeFor" | "projectId">,
  project: Pick<Project, "publishingMode" | "baseBranch">,
  initiative: Pick<Initiative, "pipelines" | "shortName"> | undefined,
): string {
  if (
    initiative &&
    initiativePipelineIn(initiative, task.projectId) !== null &&
    initiative.shortName !== null
  ) {
    const branch = initiativeBranchOf(initiative.shortName);
    if (isPublishingTask(task)) {
      return `puts ${branch} into ${project.baseBranch} by ${PUBLISHING_MODE_WORDS[project.publishingMode]}`;
    }
    return `merge into ${branch}`;
  }
  return publishingLabel(project.publishingMode, project.baseBranch).toLowerCase();
}

const PUBLISHING_MODE_WORDS: Readonly<Record<Project["publishingMode"], string>> = {
  "push-and-pull-request": "a pull request",
  merge: "one merge commit",
};
