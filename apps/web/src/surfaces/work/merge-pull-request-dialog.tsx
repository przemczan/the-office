import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MergeMethod, PullRequest } from "@the-office/contracts";
import { Alert, Button, Dialog, Field, RadioGroup, Skeleton } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { mergePullRequest, pullRequestQueries } from "../../api/pull-requests.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { PullRequestRefusalAlert, ToneBadge } from "./pull-request-parts.tsx";
import {
  branchDeletionWords,
  CHECKS_WORDS,
  endedToast,
  MERGE_BUTTON,
  MERGE_CAUTION,
  MERGE_METHOD_LABEL,
  MERGE_METHOD_WORDS,
  MERGE_METHODS_UNREAD,
  MERGE_REFUSED,
  MERGEABLE_WORDS,
  mergeCautionTitle,
  mergeIntoWords,
  mergeTitle,
} from "./pull-request-words.ts";

/**
 * Merge…: the pull request merges on its code host by the method chosen, of those it allows, the
 * recommended one picked at first. Failing checks or conflicts are a caution, not a block: the code
 * host refuses what its rules don't allow, and the window shows its words. The Office never deletes
 * the branch.
 */
export function MergePullRequestDialog({
  pullRequest,
  onClose,
}: {
  readonly pullRequest: PullRequest;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const methods = useQuery(pullRequestQueries.mergeMethods(pullRequest.id));
  const [chosen, setChosen] = useState<MergeMethod | undefined>();
  const method = chosen ?? methods.data?.recommended;
  const merging = useMerging(pullRequest, onClose);
  const caution = mergeCautionTitle(pullRequest);
  return (
    <Dialog
      size="medium"
      title={mergeTitle(pullRequest)}
      unsavedChanges={chosen !== undefined}
      onClose={onClose}
      actions={
        <Button
          type="submit"
          form={formId}
          disabled={method === undefined}
          loading={merging.isPending}
        >
          {MERGE_BUTTON}
        </Button>
      }
    >
      <form
        id={formId}
        className="work-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (method !== undefined) merging.mutate(method);
        }}
      >
        {merging.error && (
          <PullRequestRefusalAlert
            title={MERGE_REFUSED}
            error={merging.error}
            onRefreshed={() => merging.reset()}
          />
        )}
        <p className="dialog-text">{mergeIntoWords(pullRequest)}</p>
        <p className="dialog-text pull-request-status">
          Checks <ToneBadge words={CHECKS_WORDS[pullRequest.checks]} /> Mergeable{" "}
          <ToneBadge words={MERGEABLE_WORDS[pullRequest.mergeable]} />
        </p>
        {caution !== undefined && (
          <Alert tone="warning" title={caution}>
            {MERGE_CAUTION}
          </Alert>
        )}
        {methods.error && <RefusalAlert title={MERGE_METHODS_UNREAD} error={methods.error} />}
        {!methods.data ? (
          !methods.error && <Skeleton height={96} />
        ) : (
          <>
            <Field label={MERGE_METHOD_LABEL}>
              <RadioGroup
                options={methods.data.allowed.map((allowed) => ({
                  value: allowed,
                  label: MERGE_METHOD_WORDS[allowed],
                }))}
                value={method}
                onChange={(value) =>
                  setChosen(methods.data.allowed.find((allowed) => allowed === value))
                }
              />
            </Field>
            {methods.data.warning !== null && <Alert tone="warning" title={methods.data.warning} />}
            <p className="dialog-text">{branchDeletionWords(methods.data.deletesBranchOnMerge)}</p>
          </>
        )}
      </form>
    </Dialog>
  );
}

function useMerging(pullRequest: PullRequest, onMerged: () => void) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (method: MergeMethod) => mergePullRequest(pullRequest.id, method),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pullRequestQueries.all() });
      showToast(endedToast(pullRequest, "merged"));
      onMerged();
    },
  });
}
