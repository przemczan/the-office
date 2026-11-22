import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  pullRequestQueries,
  pullRequestRefusalOf,
  refreshPullRequests,
} from "../../api/pull-requests.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";

/**
 * Why a Merge or Close was refused, in the code host's words; when the pull request changed since
 * The Office last read it, with Refresh, which reads it again and lets the user try once more.
 */
export function PullRequestRefusalAlert({
  title,
  error,
  onRefreshed,
}: {
  readonly title: string;
  readonly error: Error;
  /** Once Refresh has asked for a read, so the window can clear the refusal. */
  readonly onRefreshed: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const refreshing = useMutation({
    mutationFn: refreshPullRequests,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pullRequestQueries.all() });
      onRefreshed();
    },
  });
  const refusal = pullRequestRefusalOf(error);
  if (refusal === undefined) return <RefusalAlert title={title} error={error} />;
  return (
    <Alert
      tone="danger"
      title={title}
      action={
        refusal.refresh && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="refresh-cw" size={14} />}
            loading={refreshing.isPending}
            onClick={() => refreshing.mutate()}
          >
            Refresh
          </Button>
        )
      }
    >
      {refusal.reason}
    </Alert>
  );
}
