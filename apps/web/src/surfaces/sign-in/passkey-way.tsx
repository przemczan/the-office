import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useMutation } from "@tanstack/react-query";
import type { SignInRefusal } from "@the-office/contracts";
import { Alert, Button } from "@the-office/ui";
import { RefusedAs } from "../../api/api-client.ts";
import { signInWithPasskey, startPasskeySignIn } from "../../api/passkeys.ts";
import type { SignInWayView } from "./sign-in-ways.tsx";
import { useSignedIn } from "./use-signed-in.ts";

/**
 * Signing in with a passkey alone (spec §2.10): no email asked, the browser offering the passkeys
 * it keeps for this address. Cancelling the browser's window is quiet; a refusal shows the
 * service's one answer. A browser without passkeys says so in place of the button.
 */
export const PasskeyWay: SignInWayView<"passkey"> = () => {
  const signedIn = useSignedIn();
  const signingIn = useMutation({
    mutationFn: async () => {
      const optionsJSON = await startPasskeySignIn();
      return signInWithPasskey(await startAuthentication({ optionsJSON }));
    },
    onSuccess: (outcome) =>
      // A passkey's user always has their own password, so it never asks to set one.
      outcome.outcome === "set-password" ? undefined : signedIn(outcome),
  });
  if (!browserSupportsWebAuthn()) {
    return <p className="sign-in-quiet">This browser can't sign in with a passkey.</p>;
  }
  const { error } = signingIn;
  const cancelled = error !== null && isCancelled(error);
  const refusal = error instanceof RefusedAs ? (error.refusal as SignInRefusal) : undefined;
  return (
    <div className="sign-in-form">
      {error && !cancelled && (
        <Alert tone="danger" title={refusal?.message ?? "The passkey didn't sign you in"}>
          {refusal === undefined ? error.message : undefined}
        </Alert>
      )}
      <Button
        variant="secondary"
        fullWidth
        loading={signingIn.isPending}
        onClick={() => signingIn.mutate()}
      >
        Sign in with a passkey
      </Button>
      {cancelled && (
        <p className="sign-in-quiet">No passkey was used. Try again when you're ready.</p>
      )}
    </div>
  );
};

/** The browser's window was closed or timed out, which the user did or let happen. */
function isCancelled(error: Error): boolean {
  return error.name === "NotAllowedError" || error.name === "AbortError";
}
