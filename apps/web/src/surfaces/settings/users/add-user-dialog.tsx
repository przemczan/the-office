import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { USERS, addUser } from "../../../api/users.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { OneTimePasswordShown } from "./one-time-password-shown.tsx";

/**
 * Add a user (spec §2.10): their name and email, then their one-time password, shown this once in
 * the same window.
 */
export function AddUserDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const queryClient = useQueryClient();
  const adding = useMutation({
    mutationFn: () => addUser({ name: name.trim(), email: email.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS }),
  });
  const added = adding.data;
  if (added) {
    return (
      <Dialog size="medium" title={`${added.user.name} was added`} onClose={onClose}>
        <OneTimePasswordShown
          name={added.user.name}
          email={added.user.email}
          oneTimePassword={added.oneTimePassword}
        />
      </Dialog>
    );
  }
  const missing = name.trim() === "" || email.trim() === "";
  const add = (): void => {
    if (!missing && !adding.isPending) adding.mutate();
  };
  return (
    <Dialog
      size="medium"
      title="Add a user"
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={adding.isPending}
          disabled={missing}
          title={missing ? "Give a name and an email." : undefined}
          onClick={add}
        >
          Add the user
        </Button>
      }
    >
      <form
        className="dialog-stack"
        aria-label="Add a user"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        {adding.error && <RefusalAlert title="The user can't be added" error={adding.error} />}
        <p className="dialog-text">
          The Office makes a one-time password for them, shown to you once, which you pass on. They
          set their own password at their first sign-in.
        </p>
        <Input
          label="Name"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
        />
        <Input
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </form>
    </Dialog>
  );
}
