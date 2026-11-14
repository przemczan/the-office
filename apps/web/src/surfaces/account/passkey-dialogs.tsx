import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PASSKEY_NAME_MAX_LENGTH, type Passkey } from "@the-office/contracts";
import { Button, Dialog, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { PASSKEYS, removePasskey, renamePasskey } from "../../api/passkeys.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";

export function RenamePasskeyDialog({
  passkey,
  onClose,
}: {
  readonly passkey: Passkey;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const [name, setName] = useState(passkey.name);
  const renaming = useMutation({
    mutationFn: () => renamePasskey(passkey.id, name.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PASSKEYS });
      onClose();
    },
  });
  const missing = name.trim() === "";
  const save = (): void => {
    if (!missing && !renaming.isPending) renaming.mutate();
  };
  return (
    <Dialog
      size="small"
      title={`Rename ${passkey.name}`}
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={renaming.isPending}
          disabled={missing}
          title={missing ? "Give the passkey a name." : undefined}
          onClick={save}
        >
          Save
        </Button>
      }
    >
      <form
        className="dialog-stack"
        aria-label="Rename the passkey"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {renaming.error && (
          <RefusalAlert title="The passkey can't be renamed" error={renaming.error} />
        )}
        <Input
          label="Name"
          autoComplete="off"
          maxLength={PASSKEY_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
        />
      </form>
    </Dialog>
  );
}

/** Removing a passkey, confirmed since the device keeps it but it signs nobody in again. */
export function RemovePasskeyDialog({
  passkey,
  onClose,
}: {
  readonly passkey: Passkey;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: () => removePasskey(passkey.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PASSKEYS });
      showToast(`The passkey ${passkey.name} was removed.`);
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title={`Remove ${passkey.name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove the passkey
        </Button>
      }
    >
      <div className="dialog-stack">
        {removing.error && (
          <RefusalAlert title="The passkey can't be removed" error={removing.error} />
        )}
        <p className="dialog-text">
          It no longer signs you in. Your device or password manager may still list it; remove it
          there too.
        </p>
      </div>
    </Dialog>
  );
}
