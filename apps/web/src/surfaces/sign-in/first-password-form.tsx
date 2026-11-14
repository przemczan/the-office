import { useMutation } from "@tanstack/react-query";
import type { SignInRefusal } from "@the-office/contracts";
import { Alert, Button, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { RefusedAs } from "../../api/api-client.ts";
import { setFirstPassword } from "../../api/users.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useSignedIn } from "./use-signed-in.ts";

/**
 * A user added by another, signed in with their one-time password, sets their own (spec §2.10):
 * typed twice, then sent with the one-time password again, which this page keeps in memory only,
 * and signed in. Back forgets the one-time password and returns to signing in.
 */
export function FirstPasswordForm({
  email,
  oneTimePassword,
  onBack,
}: {
  readonly email: string;
  readonly oneTimePassword: string;
  readonly onBack: () => void;
}): ReactNode {
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const signedIn = useSignedIn();
  const setting = useMutation({
    mutationFn: () => setFirstPassword({ email, oneTimePassword, password }),
    onSuccess: (outcome) => (outcome.outcome === "set-password" ? undefined : signedIn(outcome)),
  });
  const mismatch = repeated !== "" && repeated !== password;
  const error = setting.error;
  const refusal = error instanceof RefusedAs ? (error.refusal as SignInRefusal) : undefined;
  return (
    <form
      className="sign-in-form"
      aria-label="Set your password"
      onSubmit={(event) => {
        event.preventDefault();
        if (!mismatch) setting.mutate();
      }}
    >
      <p className="sign-in-lead">
        This is your first sign-in as {email}. Choose your own password; the one-time password stops
        working once it is set.
      </p>
      {refusal && <Alert tone="danger" title={refusal.message} />}
      {error && !refusal && <RefusalAlert title="The password can't be set" error={error} />}
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        autoFocus
      />
      <Input
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        value={repeated}
        onChange={(event) => setRepeated(event.target.value)}
        error={mismatch ? "The two passwords differ." : undefined}
        required
      />
      <Button
        type="submit"
        variant="primary"
        fullWidth
        disabled={setting.isPending || mismatch || repeated === ""}
        title={mismatch ? "The two passwords differ." : undefined}
      >
        Set the password and sign in
      </Button>
      <Button variant="ghost" fullWidth onClick={onBack}>
        Back to signing in
      </Button>
    </form>
  );
}
