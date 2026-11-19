import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  engineAccountQuery,
  signOutOfEngine,
  startEngineSignIn,
  useEngineAccountChanged,
} from "../../../api/engine.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { EngineApiKeyForm } from "./engine-api-key-form.tsx";
import { codexAccountLine } from "./engine-account-words.ts";

/** What the account part asks for: nothing, a Sign in's code entered on its page, or an API key. */
type Asking =
  | { readonly kind: "nothing" }
  | { readonly kind: "sign-in"; readonly signInPage: string; readonly userCode: string | undefined }
  | { readonly kind: "api-key" };

const ASKING_NOTHING: Asking = { kind: "nothing" };

/**
 * A saved Codex engine's account: its line, "Sign in with ChatGPT" (a device-code login: its page as
 * a link and the code to enter there, its end announced as `engine.account-changed`, which reads
 * the account again), "Use an API key instead" and Sign out. The key typed here stays out of the
 * engines' draft, so it never rides along in a Save and never comes back.
 */
export function CodexEngineAccount({ engineId }: { readonly engineId: string }): ReactNode {
  const queryClient = useQueryClient();
  const account = useQuery(engineAccountQuery(engineId));
  const [asking, setAsking] = useState<Asking>(ASKING_NOTHING);

  const accountChanged = () => {
    setAsking(ASKING_NOTHING);
    return queryClient.invalidateQueries(engineAccountQuery(engineId));
  };
  const signingIn = useMutation({
    mutationFn: () => startEngineSignIn(engineId),
    onSuccess: ({ url, userCode }) => setAsking({ kind: "sign-in", signInPage: url, userCode }),
  });
  const signingOut = useMutation({
    mutationFn: () => signOutOfEngine(engineId),
    onSuccess: accountChanged,
  });

  // The login's end, signed in or not, is announced; a mere read again, as on focus, ends nothing.
  useEngineAccountChanged(engineId, () => {
    if (asking.kind === "sign-in") setAsking(ASKING_NOTHING);
  });

  return (
    <div className="engine-account" role="group" aria-label="Account">
      <div className="engine-account-status">
        <span className="engine-account-line">
          {account.data
            ? codexAccountLine(account.data)
            : account.isPending
              ? "Reading the account…"
              : ""}
        </span>
        <div className="engine-account-actions">
          <Button
            variant="secondary"
            size="sm"
            loading={signingIn.isPending}
            onClick={() => signingIn.mutate()}
          >
            Sign in with ChatGPT
          </Button>
          {asking.kind !== "api-key" && (
            <Button variant="ghost" size="sm" onClick={() => setAsking({ kind: "api-key" })}>
              Use an API key instead
            </Button>
          )}
          {account.data?.signedIn && (
            <Button
              variant="danger-ghost"
              size="sm"
              loading={signingOut.isPending}
              onClick={() => signingOut.mutate()}
            >
              Sign out
            </Button>
          )}
        </div>
      </div>
      {account.error && <RefusalAlert title="The account can't be read" error={account.error} />}
      {signingIn.error && <RefusalAlert title="Signing in can't start" error={signingIn.error} />}
      {signingOut.error && <RefusalAlert title="It wasn't signed out" error={signingOut.error} />}

      {asking.kind === "sign-in" && (
        <div className="engine-account-form" role="group" aria-label="Sign in with ChatGPT">
          <p className="engine-account-hint">
            Open{" "}
            <a
              className="engine-account-link"
              href={asking.signInPage}
              target="_blank"
              rel="noreferrer"
            >
              the sign-in page
            </a>{" "}
            in any browser, sign in with ChatGPT
            {asking.userCode === undefined ? "." : " and enter this code there:"}
          </p>
          {asking.userCode !== undefined && (
            <code className="engine-account-code" aria-label="The code to enter">
              {asking.userCode}
            </code>
          )}
          <div className="engine-account-entry">
            <span className="engine-account-hint" role="status">
              Waiting for the sign-in to finish…
            </span>
            <Button variant="ghost" size="sm" onClick={() => setAsking(ASKING_NOTHING)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {asking.kind === "api-key" && (
        <EngineApiKeyForm
          engineId={engineId}
          hint="An OpenAI API key signs this engine in, in place of a ChatGPT sign-in."
          keptWhere="Kept in the database"
          saveLabel="Save the key"
          saved={accountChanged}
          cancel={() => setAsking(ASKING_NOTHING)}
        />
      )}
    </div>
  );
}
