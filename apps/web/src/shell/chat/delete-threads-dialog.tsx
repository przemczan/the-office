import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  decisionQueries,
  deleteChatThreads,
  dropDeletedThreads,
  proposalQueries,
} from "../../api/conversations.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { deleteTitle, deletedToast } from "./deletion-words.ts";

/** The Threads in the window: what shows of each, and whether the person is answering in it. */
export interface DoomedThread {
  readonly id: string;
  readonly title: string;
  readonly answering: boolean;
}

const SHOWN_TITLES = 4;

/**
 * The confirmation before chat Threads are deleted, from the selection bar's Delete and the open
 * Thread's trash icon alike (spec screens/shell.md, A person's chat): small, Delete first and in
 * red, Close on the right, saying it is for good and what stays. A refusal shows its reason in the
 * window and changes nothing.
 */
export function DeleteThreadsDialog({
  roleKey,
  personName,
  threads,
  fromHead,
  onClose,
  onDeleted,
}: {
  readonly roleKey: string;
  readonly personName: string;
  readonly threads: readonly DoomedThread[];
  /** From the open Thread's head, which the window titles as "this Thread". */
  readonly fromHead: boolean;
  readonly onClose: () => void;
  /** The Threads are gone and the toast said so. */
  readonly onDeleted: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const ids = threads.map(({ id }) => id);
  const deleting = useMutation({
    mutationFn: () => deleteChatThreads(roleKey, ids),
    onSuccess: () => {
      dropDeletedThreads(queryClient, roleKey, ids);
      showToast(deletedToast(ids.length));
      onDeleted();
    },
  });
  // What else changes goes by what waits in them: the lists are the ones Waiting for you reads.
  const decisions = useQuery(decisionQueries.open()).data;
  const proposals = useQuery(proposalQueries.open()).data;
  const doomed = new Set(ids);
  const waitingDecisions = decisions?.filter(({ threadId }) => doomed.has(threadId)).length ?? 0;
  const openProposals = proposals?.filter(({ threadId }) => doomed.has(threadId)).length ?? 0;
  const one = threads.length === 1;
  const effects = [
    threads.some(({ answering }) => answering) &&
      `${personName}'s answer in ${one ? "it" : "one of them"} is stopped first.`,
    waitingDecisions > 0 &&
      `${waitingDecisions === 1 ? "1 waiting Decision is" : `${waitingDecisions} waiting Decisions are`} withdrawn.`,
    openProposals > 0 &&
      `${openProposals === 1 ? "1 open Proposal is" : `${openProposals} open Proposals are`} declined.`,
  ].filter((effect) => effect !== false);
  const shown = threads.slice(0, SHOWN_TITLES);
  const more = threads.length - shown.length;
  const confirmWords = one ? "Delete the Thread" : `Delete ${threads.length} Threads`;
  return (
    <Dialog
      size="small"
      title={deleteTitle(threads.length, personName, fromHead)}
      // Closing mid-delete would leave the user not knowing whether it happened.
      onClose={deleting.isPending ? () => undefined : onClose}
      actions={
        <Button
          variant="danger"
          iconLeft={<Icon name="trash-2" size={14} />}
          loading={deleting.isPending}
          onClick={() => deleting.mutate()}
        >
          {confirmWords}
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">
          {one ? "Its" : "Their"} messages, images and {one ? "session are" : "sessions are"}{" "}
          deleted for good. This can't be undone.
        </p>
        <ul className="delete-threads-titles">
          {shown.map(({ id, title }) => (
            <li key={id}>
              <Icon name="message-circle" size={14} />
              <span>{title}</span>
            </li>
          ))}
          {more > 0 && <li className="delete-threads-more">and {more} more</li>}
        </ul>
        {effects.length > 0 && (
          <div className="delete-threads-effects">
            <Icon name="triangle-alert" size={16} />
            <ul>
              {effects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="delete-threads-kept">
          <Icon name="info" size={14} />
          <span>
            Tasks, Ideas and Memory notes made in {one ? "it" : "them"} stay, and so do{" "}
            {one ? "its" : "their"} tokens in Stats.
          </span>
        </p>
        {deleting.error && (
          <RefusalAlert
            title={one ? "The Thread wasn't deleted" : "The Threads weren't deleted"}
            error={deleting.error}
          />
        )}
      </div>
    </Dialog>
  );
}
