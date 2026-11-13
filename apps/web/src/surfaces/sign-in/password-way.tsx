import { useMutation } from "@tanstack/react-query";
import type { SignInRefusal } from "@the-office/contracts";
import { Alert, Button, Input } from "@the-office/ui";
import { useState } from "react";
import { RefusedAs } from "../../api/api-client.ts";
import { signInWithPassword } from "../../api/users.ts";
import { useClock } from "../../shell/use-clock.ts";
import { tryAgainWords } from "./sign-in-words.ts";
import type { SignInWayView } from "./sign-in-ways.tsx";
import { useSignedIn } from "./use-signed-in.ts";

/**
 * Signing in with an email and a password. A refusal shows the service's words and, once wrong
 * tries cost a wait or locked the password, when to try again, the button waiting until then.
 */
export const PasswordWay: SignInWayView<"password"> = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signedIn = useSignedIn();
  const signingIn = useMutation({
    mutationFn: () => signInWithPassword({ email: email.trim(), password }),
    onSuccess: signedIn,
  });
  const error = signingIn.error;
  const refusal = error instanceof RefusedAs ? (error.refusal as SignInRefusal) : undefined;
  const waitWords = useTryAgainWords(refusal?.tryAgainAt);
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

/** When to try again, renewed every second while a wait runs; undefined with none. */
function useTryAgainWords(tryAgainAt: string | undefined): string | undefined {
  const now = useClock(1000);
  return tryAgainAt === undefined ? undefined : tryAgainWords(tryAgainAt, now);
}
