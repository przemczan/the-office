import type { TaskStage } from "@the-office/contracts";
import { Icon, LinkButton } from "@the-office/ui";
import type { RecordAction } from "./record-actions.tsx";
import { pullRequestUrlOf } from "./stage-words.ts";

/** "Open pull request" in a Task's head, once its Publish has opened one: a link, in a new tab. */
export function pullRequestAction(
  taskStages: readonly TaskStage[] | null | undefined,
): RecordAction | undefined {
  const url = pullRequestUrlOf(taskStages);
  if (url === undefined) return undefined;
  return {
    key: "open-pull-request",
    label: "Open pull request",
    icon: "external-link",
    onSelect: () => window.open(url, "_blank", "noopener,noreferrer"),
    control: (
      <LinkButton href={url} target="_blank" rel="noopener noreferrer">
        Open pull request
        <Icon name="external-link" size={14} />
      </LinkButton>
    ),
  };
}
