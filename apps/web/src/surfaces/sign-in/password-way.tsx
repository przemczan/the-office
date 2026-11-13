import { useMutation } from "@tanstack/react-query";
import type { SignInRefusal } from "@the-office/contracts";
import { Alert, Button, Input } from "@the-office/ui";
import { useState } from "react";
import { RefusedAs } from "../../api/api-client.ts";
import { signInWithPassword } from "../../api/users.ts";
import { useTryAgainWords } from "../../shell/try-again-words.ts";
import { FirstPasswordForm } from "./first-password-form.tsx";
import type { SignInWayView } from "./sign-in-ways.tsx";
import { useSignedIn } from "./use-signed-in.ts";

/**
 * Signing in with an email and a password. A refusal shows the service's words and, once wrong
 * tries cost a wait or locked the password, when to try again, the button waiting until then. A
 * right one-time password goes on to setting the user's own password, in place of this form.
 */
export const PasswordWay: SignInWayView<"password"> = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oneTimePassword, setOneTimePassword] = useState<string>();
  const signedIn = useSignedIn();
  const signingIn = useMutation({
    mutationFn: () => signInWithPassword({ email: email.trim(), password }),
    onSuccess: (outcome) => {
      if (outcome.outcome !== "set-password") return signedIn(outcome);
      setOneTimePassword(password);
      setPassword("");
      return undefined;
    },
  });
  const error = signingIn.error;
  const refusal = error instanceof RefusedAs ? (error.refusal as SignInRefusal) : undefined;
  const waitWords = useTryAgainWords(refusal?.tryAgainAt);
  if (oneTimePassword !== undefined) {
    return (
      <FirstPasswordForm
        email={email.trim()}
        oneTimePassword={oneTimePassword}
        onBack={() => {
          setOneTimePassword(undefined);
          signingIn.reset();
        }}
      />
    );
  }
  return (
    <form
      className="sign-in-form"
      aria-label="Sign in with a password"
      onSubmit={(event) => {
        event.preventDefault();
        signingIn.mutate();
      }}
    >
      {error && (
        <Alert tone="danger" title={refusal?.message ?? error.message}>
          {waitWords}
        </Alert>
      )}
      <Input
        label="Email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        autoFocus
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <Button
        type="submit"
        variant="primary"
        fullWidth
        disabled={signingIn.isPending || waitWords !== undefined}
        title={waitWords}
      >
        Sign in
      </Button>
    </form>
  );
};
