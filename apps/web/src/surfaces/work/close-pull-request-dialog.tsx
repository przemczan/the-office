import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PullRequest } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { closePullRequest, pullRequestQueries } from "../../api/pull-requests.ts";
import { useToast } from "../../shell/toasts.tsx";
import { PullRequestRefusalAlert } from "./pull-request-parts.tsx";
import {
  CLOSE_BUTTON,
  CLOSE_REFUSED,
  closeQuestion,
  closeTitle,
  endedToast,
} from "./pull-request-words.ts";

/** Close…: the pull request closes on its code host without merging; its branch stays. */
export function ClosePullRequestDialog({
  pullRequest,
  onClose,
}: {
  readonly pullRequest: PullRequest;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const closing = useMutation({
    mutationFn: () => closePullRequest(pullRequest.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pullRequestQueries.all() });
      showToast(endedToast(pullRequest, "closed"));
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title={closeTitle(pullRequest)}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={closing.isPending} onClick={() => closing.mutate()}>
          {CLOSE_BUTTON}
        </Button>
      }
    >
      <div className="work-form">
        {closing.error && (
          <PullRequestRefusalAlert
            title={CLOSE_REFUSED}
            error={closing.error}
            onRefreshed={() => closing.reset()}
          />
        )}
        <p className="dialog-text">{closeQuestion(pullRequest)}</p>
      </div>
    </Dialog>
  );
}
