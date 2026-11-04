import type { TaskStage } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
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
    <Button
      variant="secondary"
      iconRight={<Icon name="external-link" size={14} />}
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
    >
      Open pull request
    </Button>
  );
}
