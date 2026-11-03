import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@the-office/ui";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  engineAccountQuery,
  enterEngineSignInCode,
  pasteEngineToken,
  signOutOfEngine,
  startEngineSignIn,
} from "../../../api/engine.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { engineAccountLine } from "./engine-account-words.ts";

/** What the account part asks for: nothing, a Sign in's code, or a pasted token. */
type Asking =
  | { readonly kind: "nothing" }
  | { readonly kind: "code"; readonly signInPage: string }
  | { readonly kind: "token" };

const ASKING_NOTHING: Asking = { kind: "nothing" };

/** A form here sends by `send`, never by the page's own submit. */
function submit(event: FormEvent, send: () => void): void {
  event.preventDefault();
  send();
}

/**
 * A saved Claude Code engine's account: the line `claude auth status` gives, Sign in (its page as a
 * link, its code pasted back), "Paste a token instead" and Sign out. What is typed here stays out of
 * the engines' draft, so the token never rides along in a Save and never comes back.
 */
export function ClaudeCodeEngineAccount({ engineId }: { readonly engineId: string }): ReactNode {
  const queryClient = useQueryClient();
  const account = useQuery(engineAccountQuery(engineId));
  const [asking, setAsking] = useState<Asking>(ASKING_NOTHING);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");

  const accountChanged = () => {
    setAsking(ASKING_NOTHING);
    setCode("");
    setToken("");
    return queryClient.invalidateQueries(engineAccountQuery(engineId));
  };
  const signingIn = useMutation({
    mutationFn: () => startEngineSignIn(engineId),
    onSuccess: ({ url }) => ask({ kind: "code", signInPage: url }),
  });
  const enteringCode = useMutation({
    mutationFn: (typed: string) => enterEngineSignInCode(engineId, typed),
    onSuccess: accountChanged,
  });
  const pastingToken = useMutation({
    mutationFn: (typed: string) => pasteEngineToken(engineId, typed),
    onSuccess: accountChanged,
  });
  const signingOut = useMutation({
    mutationFn: () => signOutOfEngine(engineId),
    onSuccess: accountChanged,
  });

  // What was typed for one ask never carries into the next, a token least of all.
  const ask = (next: Asking) => {
    enteringCode.reset();
    pastingToken.reset();
    setCode("");
    setToken("");
    setAsking(next);
  };

  return (
    <div className="engine-account" role="group" aria-label="Account">
      <div className="engine-account-status">
        <span className="engine-account-line">
          {account.data
            ? engineAccountLine(account.data)
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

      {asking.kind === "code" && (
        <form
          className="engine-account-form"
          onSubmit={(event) => submit(event, () => enteringCode.mutate(code))}
        >
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
            in any browser, sign in with the Claude account, and paste the code it gives.
          </p>
          <div className="engine-account-entry">
            <Input
              label="Code"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={code.trim() === ""}
              loading={enteringCode.isPending}
            >
              Finish
            </Button>
            <Button variant="ghost" size="sm" onClick={() => ask(ASKING_NOTHING)}>
              Cancel
            </Button>
          </div>
          {enteringCode.error && (
            <RefusalAlert title="The code didn't sign it in" error={enteringCode.error} />
          )}
        </form>
      )}

      {asking.kind === "token" && (
        <form
          className="engine-account-form"
          onSubmit={(event) => submit(event, () => pastingToken.mutate(token))}
        >
          <p className="engine-account-hint">
            Make one with <code>claude setup-token</code> and paste it here. It signs this engine
            in, kept in the engine&apos;s folder, and is never shown again.
          </p>
          <div className="engine-account-entry">
            <Input
              label="Token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
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
