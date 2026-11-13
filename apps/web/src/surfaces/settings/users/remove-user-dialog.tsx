import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { USERS, removeUser } from "../../../api/users.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";

/** Removing a user (spec §2.10), confirmed since it signs out all their devices at once. */
export function RemoveUserDialog({
  user,
  onClose,
}: {
  readonly user: User;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: () => removeUser(user.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USERS });
      showToast(`${user.name} was removed.`);
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title={`Remove ${user.name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove {user.name}
        </Button>
      }
    >
      <div className="dialog-stack">
        {removing.error && (
          <RefusalAlert title={`${user.name} can't be removed`} error={removing.error} />
        )}
        <p className="dialog-text">
          {user.name} is signed out on all their devices at once and can no longer sign in. What
          they did keeps their name.
        </p>
        <p className="dialog-text">Their email can be given to a new user afterwards.</p>
      </div>
    </Dialog>
  );
}
