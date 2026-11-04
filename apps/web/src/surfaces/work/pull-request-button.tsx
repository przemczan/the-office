import type { TaskStage } from "@the-office/contracts";
import { Icon, LinkButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { pullRequestUrlOf } from "./stage-words.ts";

/** "Open pull request" in a Task's head, once its Publish has opened one. */
export function PullRequestButton({
  taskStages,
}: {
  readonly taskStages: readonly TaskStage[] | null | undefined;
}): ReactNode {
  const url = pullRequestUrlOf(taskStages);
  if (url === undefined) return null;
  return (
    <LinkButton href={url} target="_blank" rel="noopener noreferrer">
      Open pull request
      <Icon name="external-link" size={14} />
    </LinkButton>
  );
}
