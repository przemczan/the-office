import { initiativeBranchOf, type Initiative, type Project } from "@the-office/contracts";
import { publishingLabel } from "../../shell/project-words.ts";

/**
 * How the Task's Publish ships, in a Stage's words: by the Project's publishing mode, or by merge
 * into its Initiative's branch when the Initiative has a Pipeline (spec 2.3).
 */
export function taskPublishingWords(
  project: Pick<Project, "publishingMode" | "baseBranch">,
  initiative: Pick<Initiative, "pipelineId" | "shortName"> | undefined,
): string {
  if (initiative && initiative.pipelineId !== null && initiative.shortName !== null) {
    return `merge into ${initiativeBranchOf(initiative.shortName)}`;
  }
  return publishingLabel(project.publishingMode, project.baseBranch).toLowerCase();
}
