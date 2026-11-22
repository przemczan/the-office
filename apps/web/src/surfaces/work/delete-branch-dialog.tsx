import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BranchDeletionPreview, BranchWork } from "@the-office/contracts";
import { Alert, Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { branchQueries, deleteBranch, type BranchOwnerRef } from "../../api/branch-deletions.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { commitsLostWords, moreSubjectsWords, SHOWN_SUBJECTS } from "./branch-deletion-words.ts";

/**
 * "Delete <branch>?" (spec 5.5, "Deleting merged branches"), from a Task's menu or an Initiative's
 * Facts: judged as it opens, it lists what goes, and offers Delete branch when everything on it is
 * in the base, Delete anyway after a warning naming what is lost, or nothing with the reason it is
 * refused.
 */
export function DeleteBranchDialog({
  owner,
  branch,
  onClose,
}: {
  readonly owner: BranchOwnerRef;
  readonly branch: string;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const judging = useQuery(branchQueries.deletion(owner));
  const preview = judging.data;
  const deleting = useMutation({
    mutationFn: (judged: BranchDeletionPreview) =>
      deleteBranch(owner, {
        expected: judged.copies.map(({ kind, commit }) => ({ kind, commit })),
        deleteUnmerged: judged.holdsWork !== null,
      }),
    onSuccess: () => {
      showToast(`Branch ${branch} deleted.`);
      void queryClient.invalidateQueries({
        queryKey:
          owner.kind === "task" ? ["tasks", owner.taskId] : ["initiatives", owner.initiativeId],
      });
      onClose();
    },
  });
  const deletable = preview !== undefined && preview.refusal === null;
  return (
    <Dialog
      size="small"
      title={`Delete ${branch}?`}
      onClose={onClose}
      actions={
        deletable && (
          <Button
            variant="danger"
            loading={deleting.isPending}
            onClick={() => deleting.mutate(preview)}
          >
            {preview.holdsWork === null ? "Delete branch" : "Delete anyway"}
          </Button>
        )
      }
    >
      <div className="dialog-stack">
        {deleting.error && <RefusalAlert title="Nothing was deleted" error={deleting.error} />}
        {judging.error && (
          <RefusalAlert title="The branch couldn't be checked" error={judging.error} />
        )}
        {judging.isPending && (
          <p className="dialog-text" role="status">
            Checking the branch…
          </p>
        )}
        {preview && <PreviewView preview={preview} />}
      </div>
    </Dialog>
  );
}

function PreviewView({ preview }: { readonly preview: BranchDeletionPreview }): ReactNode {
  if (preview.refusal !== null) {
    return <Alert tone="danger" title={preview.refusal} />;
  }
  return (
    <>
      <div>
        <p className="dialog-text">Deleting it removes:</p>
        <ul className="branch-deletion-list" aria-label="What goes">
          {preview.copies.map((copy) => (
            <li key={copy.kind}>
              {copy.kind === "local" ? "The branch " : "The remote copy "}
              <code>{copy.name}</code>
            </li>
          ))}
          {preview.worktreePath !== null && (
            <li>
              The Task&apos;s worktree <code>{preview.worktreePath}</code>
            </li>
          )}
        </ul>
      </div>
      {preview.holdsWork === null ? (
        <p className="dialog-text">Everything on it is in {preview.baseBranch}.</p>
      ) : (
        <WorkLost work={preview.holdsWork} baseBranch={preview.baseBranch} />
      )}
    </>
  );
}

function WorkLost({
  work,
  baseBranch,
}: {
  readonly work: BranchWork;
  readonly baseBranch: string;
}): ReactNode {
  const more = moreSubjectsWords(work);
  return (
    <Alert tone="warning" title={commitsLostWords(work.commitCount, baseBranch)}>
      <ul className="branch-deletion-list">
        {work.subjects.slice(0, SHOWN_SUBJECTS).map((subject, index) => (
          <li key={index}>{subject}</li>
        ))}
        {more !== undefined && <li className="branch-deletion-more">{more}</li>}
      </ul>
      {work.unpublishedTaskTitles.length > 0 && (
        <>
          <p className="branch-deletion-tasks-title">Tasks no Publish took to {baseBranch}:</p>
          <ul className="branch-deletion-list">
            {work.unpublishedTaskTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </>
      )}
    </Alert>
  );
}
