import { useQuery } from "@tanstack/react-query";
import type { PullRequestEnd, TaskStage } from "@the-office/contracts";
import { Badge, Icon, LinkButton, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { useSignedInUserId } from "../../shell/use-user-name.ts";
import { PULL_REQUEST_END_BADGE, pullRequestEndWords } from "./pull-request-words.ts";
import type { RecordAction } from "./record-actions.tsx";
import { pullRequestUrlOf } from "./stage-words.ts";

/**
 * "Open pull request" in a Task's head, once its Publish has opened one: a link, in a new tab; once
 * the pull request was merged or closed, a badge beside it says so.
 */
export function pullRequestAction(
  taskStages: readonly TaskStage[] | null | undefined,
  pullRequestEnd: PullRequestEnd | null = null,
): RecordAction | undefined {
  const url = pullRequestUrlOf(taskStages) ?? pullRequestEnd?.url;
  if (url === undefined) return undefined;
  const link = (
    <LinkButton href={url} target="_blank" rel="noopener noreferrer">
      Open pull request
      <Icon name="external-link" size={14} />
    </LinkButton>
  );
  return {
    key: "open-pull-request",
    label: "Open pull request",
    icon: "external-link",
    onSelect: () => window.open(url, "_blank", "noopener,noreferrer"),
    control:
      pullRequestEnd === null ? (
        link
      ) : (
        <span className="pull-request-end">
          <PullRequestEndBadge end={pullRequestEnd} />
          {link}
        </span>
      ),
  };
}

/** "Pull request merged" or "Pull request closed", with how, by whom and when on hover. */
export function PullRequestEndBadge({ end }: { readonly end: PullRequestEnd }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const signedInUserId = useSignedInUserId();
  return (
    <Tooltip content={pullRequestEndWords(end, roles, signedInUserId)} focusable>
      <Badge tone={end.outcome === "merged" ? "success" : "neutral"}>
        {PULL_REQUEST_END_BADGE[end.outcome]}
      </Badge>
    </Tooltip>
  );
}
