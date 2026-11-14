import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { USERS, newOneTimePassword } from "../../../api/users.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { OneTimePasswordShown } from "./one-time-password-shown.tsx";

/**
 * A new one-time password for a user still waiting for their first sign-in (spec §2.10 Defaults),
 * confirmed since it ends the one passed on before; then shown this once.
 */
export function NewOneTimePasswordDialog({
  user,
  onClose,
}: {
  readonly user: User;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const making = useMutation({
    mutationFn: () => newOneTimePassword(user.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS }),
  });
  if (making.data !== undefined) {
    return (
      <Dialog size="medium" title={`${user.name}'s new one-time password`} onClose={onClose}>
        <OneTimePasswordShown name={user.name} email={user.email} oneTimePassword={making.data} />
      </Dialog>
    );
  }
  return (
    <Dialog
      size="small"
      title={`Make a new one-time password for ${user.name}?`}
      onClose={onClose}
      actions={
        <Button variant="primary" loading={making.isPending} onClick={() => making.mutate()}>
          Make a new one
        </Button>
      }
    >
      <div className="dialog-stack">
        {making.error && (
          <RefusalAlert title="The one-time password can't be made" error={making.error} />
        )}
        <p className="dialog-text">
          The one-time password {user.name} has stops working, and the new one works for 7 days.
        </p>
      </div>
    </Dialog>
  );
}
