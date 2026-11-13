import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PASSKEY_NAME_MAX_LENGTH, type PasskeyCreationOptions } from "@the-office/contracts";
import { Button, Dialog, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { PASSKEYS, addPasskey, startAddingPasskey } from "../../api/passkeys.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";

/**
 * Adding a passkey (spec §2.10): the current password first, so a borrowed signed-in browser can't
 * add a lasting way in, then the passkey's name, then the browser's own window makes it. Closing
 * that window is quiet and Add tries again.
 */
export function AddPasskeyDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const [options, setOptions] = useState<PasskeyCreationOptions>();
  return options === undefined ? (
    <CurrentPasswordStep onClose={onClose} onOptions={setOptions} />
  ) : (
    <NameStep options={options} onClose={onClose} />
  );
}

function CurrentPasswordStep({
  onClose,
  onOptions,
}: {
  readonly onClose: () => void;
  readonly onOptions: (options: PasskeyCreationOptions) => void;
}): ReactNode {
  const [currentPassword, setCurrentPassword] = useState("");
  const starting = useMutation({
    mutationFn: () => startAddingPasskey(currentPassword),
    onSuccess: onOptions,
  });
  const go = (): void => {
    if (currentPassword !== "" && !starting.isPending) starting.mutate();
  };
  return (
    <Dialog
      size="medium"
      title="Add a passkey"
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={starting.isPending}
          disabled={currentPassword === ""}
          title={currentPassword === "" ? "Give your current password." : undefined}
          onClick={go}
        >
          Continue
        </Button>
      }
    >
      <form
        className="dialog-stack"
        aria-label="Your current password"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        {starting.error && (
          <RefusalAlert title="The passkey can't be added" error={starting.error} />
        )}
        <p className="dialog-text">
          A passkey signs you in alone, so The Office asks for your current password first.
        </p>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          autoFocus
        />
      </form>
    </Dialog>
  );
}

function NameStep({
  options,
  onClose,
}: {
  readonly options: PasskeyCreationOptions;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [name, setName] = useState("");
  const adding = useMutation({
    mutationFn: async () => {
      const registration = await startRegistration({ optionsJSON: options });
      return addPasskey({ name: name.trim(), registration });
    },
    onSuccess: async (passkey) => {
      await queryClient.invalidateQueries({ queryKey: PASSKEYS });
      showToast(`The passkey ${passkey.name} was added.`);
      onClose();
    },
  });
  const cancelled = adding.error !== null && isCancelled(adding.error);
  const missing = name.trim() === "";
  const add = (): void => {
    if (!missing && !adding.isPending) adding.mutate();
  };
  return (
    <Dialog
      size="medium"
      title="Name the passkey"
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={adding.isPending}
          disabled={missing}
          title={missing ? "Give the passkey a name." : undefined}
          onClick={add}
        >
          Add the passkey
        </Button>
      }
    >
      <form
        className="dialog-stack"
        aria-label="Name the passkey"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        {adding.error && !cancelled && (
          <RefusalAlert title="The passkey can't be added" error={adding.error} />
        )}
        <p className="dialog-text">
          A name tells your passkeys apart, such as the device or password manager that keeps it.
          Your browser then asks you to make it.
        </p>
        <Input
          label="Name"
          autoComplete="off"
          maxLength={PASSKEY_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
        />
        {cancelled && (
          <p className="dialog-text">No passkey was made. Add the passkey to try again.</p>
        )}
      </form>
    </Dialog>
  );
}

/** The browser's window was closed or timed out, which the user did or let happen. */
function isCancelled(error: Error): boolean {
  return error.name === "NotAllowedError" || error.name === "AbortError";
}
