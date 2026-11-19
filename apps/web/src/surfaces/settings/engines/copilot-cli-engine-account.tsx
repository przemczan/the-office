import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { copilotCliPastedTokenSchema } from "@the-office/contracts";
import { Button, Input } from "@the-office/ui";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  engineAccountQuery,
  pasteEngineToken,
  signOutOfEngine,
  startEngineSignIn,
  useEngineAccountChanged,
} from "../../../api/engine.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { copilotCliAccountLine } from "./engine-account-words.ts";

/** What the account part asks for: nothing, a Sign in's code entered on GitHub's page, or a token. */
type Asking =
  | { readonly kind: "nothing" }
  | { readonly kind: "sign-in"; readonly signInPage: string; readonly userCode: string | undefined }
  | { readonly kind: "token" };

const ASKING_NOTHING: Asking = { kind: "nothing" };

/**
 * A saved Copilot CLI engine's account: its line, Sign in (a device-code login: GitHub's page as a
 * link and the code to enter there, its end announced as `engine.account-changed`, which reads the
 * account again), "Paste a token instead" (a fine-grained personal access token with the Copilot
 * Requests permission) and Sign out. The token typed here stays out of the engines' draft, so it
 * never rides along in a Save and never comes back.
 */
export function CopilotCliEngineAccount({ engineId }: { readonly engineId: string }): ReactNode {
  const queryClient = useQueryClient();
  const account = useQuery(engineAccountQuery(engineId));
  const [asking, setAsking] = useState<Asking>(ASKING_NOTHING);
  const [token, setToken] = useState("");
  const [tokenProblem, setTokenProblem] = useState<string | undefined>(undefined);

  const ask = (next: Asking) => {
    pastingToken.reset();
    setToken("");
    setTokenProblem(undefined);
    setAsking(next);
  };
  const accountChanged = () => {
    ask(ASKING_NOTHING);
    return queryClient.invalidateQueries(engineAccountQuery(engineId));
  };
  const signingIn = useMutation({
    mutationFn: () => startEngineSignIn(engineId),
    onSuccess: ({ url, userCode }) => ask({ kind: "sign-in", signInPage: url, userCode }),
  });
  const pastingToken = useMutation({
    mutationFn: (typed: string) => pasteEngineToken(engineId, typed),
    onSuccess: accountChanged,
  });
  const signingOut = useMutation({
    mutationFn: () => signOutOfEngine(engineId),
    onSuccess: accountChanged,
  });

  // The login's end, signed in or not, is announced; a mere read again, as on focus, ends nothing.
  useEngineAccountChanged(engineId, () => {
    if (asking.kind === "sign-in") ask(ASKING_NOTHING);
  });

  const saveToken = (event: FormEvent) => {
    event.preventDefault();
    const checked = copilotCliPastedTokenSchema.safeParse({ token });
    if (!checked.success) {
      setTokenProblem(checked.error.issues[0]?.message);
      return;
    }
    setTokenProblem(undefined);
    pastingToken.mutate(checked.data.token);
  };

  return (
    <div className="engine-account" role="group" aria-label="Account">
      <div className="engine-account-status">
        <span className="engine-account-line">
          {account.data
            ? copilotCliAccountLine(account.data)
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
            Sign in
          </Button>
          {asking.kind !== "token" && (
            <Button variant="ghost" size="sm" onClick={() => ask({ kind: "token" })}>
              Paste a token instead
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
        <div className="engine-account-form" role="group" aria-label="Sign in with GitHub">
          <p className="engine-account-hint">
            Open{" "}
            <a
              className="engine-account-link"
              href={asking.signInPage}
              target="_blank"
              rel="noreferrer"
            >
              GitHub&apos;s sign-in page
            </a>{" "}
            in any browser, sign in to GitHub
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
            <Button variant="ghost" size="sm" onClick={() => ask(ASKING_NOTHING)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {asking.kind === "token" && (
        <form className="engine-account-form" onSubmit={saveToken}>
          <p className="engine-account-hint">
            Make a fine-grained personal access token on GitHub with the Copilot Requests permission
            and paste it here. It signs this engine in, kept in the database, and is never shown
            again.
          </p>
          <div className="engine-account-entry">
            <Input
              label="Token"
              type="password"
              autoComplete="off"
              value={token}
              error={tokenProblem}
              onChange={(event) => {
                setToken(event.target.value);
                setTokenProblem(undefined);
              }}
            />
            <Button
              type="submit"
              size="sm"
              disabled={token.trim() === ""}
              loading={pastingToken.isPending}
            >
              Save the token
            </Button>
            <Button variant="ghost" size="sm" onClick={() => ask(ASKING_NOTHING)}>
              Cancel
            </Button>
          </div>
          {pastingToken.error && (
            <RefusalAlert title="The token wasn't saved" error={pastingToken.error} />
          )}
        </form>
      )}
    </div>
  );
}
