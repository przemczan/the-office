import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Button, Dialog, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { allowChanges, switchChangesOff, threadQueries } from "../../api/conversations.ts";
import { RefusalAlert } from "../refusal-alert.tsx";

/**
 * Allow changes in a Caretaker Thread (spec §2.4): off, the Thread only reads and offers the
 * switch, confirmed first; on, a banner says so, with Switch off. Either way the session restarts.
 */
export function AllowChangesBar({ thread }: { readonly thread: Thread }): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const switching = useMutation({
    mutationFn: (allowed: boolean) =>
      allowed ? allowChanges(thread.id) : switchChangesOff(thread.id),
    onSuccess: async (switched) => {
      queryClient.setQueryData(threadQueries.one(switched.id).queryKey, switched);
      // The switch is logged as a line.
      await queryClient.invalidateQueries(threadQueries.messages(switched.id));
      setConfirming(false);
    },
  });
  const allowed = thread.changesAllowed === true;
  return (
    <>
      {switching.error && !confirming && (
        <RefusalAlert title="That didn't change" error={switching.error} />
      )}
      <p className={`thread-changes${allowed ? " allowed" : ""}`} role="note">
        <Icon name={allowed ? "shield-alert" : "eye"} size={14} />
        <span className="thread-changes-text">
          {allowed
            ? "Changes allowed in this Thread: the Caretaker can do anything on the workstation except read your secrets"
            : "The Caretaker only reads in this Thread."}
        </span>
        {allowed ? (
          <Button
            size="sm"
            variant="secondary"
            loading={switching.isPending}
            onClick={() => switching.mutate(false)}
          >
            Switch off
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="shield-alert" size={14} />}
            disabled={thread.state === "answering"}
            title={
              thread.state === "answering"
                ? "Wait for the answer to finish, then Allow changes"
                : undefined
            }
            onClick={() => {
              switching.reset();
              setConfirming(true);
            }}
          >
            Allow changes
          </Button>
        )}
      </p>
      {confirming && (
        <Dialog
          title="Allow changes in this Thread?"
          tone="danger"
          width={480}
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={switching.isPending}
                onClick={() => switching.mutate(true)}
              >
                Allow changes
              </Button>
            </>
          }
        >
          {switching.error && (
            <RefusalAlert title="Changes weren't allowed" error={switching.error} />
          )}
          <p className="dialog-text">
            The Caretaker can read and edit any file and run any command on the workstation in this
            Thread, git push included. Your secrets stay refused: SSH keys, credentials, browser
            profiles, the Office identity and the database credentials.
          </p>
          <p className="dialog-text">The Caretaker's session restarts under the new rules.</p>
        </Dialog>
      )}
    </>
  );
}
