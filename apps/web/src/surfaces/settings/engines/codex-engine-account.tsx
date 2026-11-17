import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@the-office/ui";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  engineAccountQuery,
  setEngineApiKey,
  signOutOfEngine,
  startEngineSignIn,
  useEngineAccountChanged,
} from "../../../api/engine.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
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
  const [key, setKey] = useState("");

  const accountChanged = () => {
    setAsking(ASKING_NOTHING);
    setKey("");
    return queryClient.invalidateQueries(engineAccountQuery(engineId));
  };
  const signingIn = useMutation({
    mutationFn: () => startEngineSignIn(engineId),
    onSuccess: ({ url, userCode }) => ask({ kind: "sign-in", signInPage: url, userCode }),
  });
  const givingKey = useMutation({
    mutationFn: (typed: string) => setEngineApiKey(engineId, typed),
    onSuccess: accountChanged,
  });
  const signingOut = useMutation({
    mutationFn: () => signOutOfEngine(engineId),
    onSuccess: accountChanged,
  });

  // What was typed for one ask never carries into the next, a key least of all.
  const ask = (next: Asking) => {
    givingKey.reset();
    setKey("");
    setAsking(next);
  };

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
            <Button variant="ghost" size="sm" onClick={() => ask({ kind: "api-key" })}>
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
            <Button variant="ghost" size="sm" onClick={() => ask(ASKING_NOTHING)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {asking.kind === "api-key" && (
        <form
          className="engine-account-form"
          onSubmit={(event) => submit(event, () => givingKey.mutate(key))}
        >
          <p className="engine-account-hint">
            An OpenAI API key signs this engine in, in place of a ChatGPT sign-in.
          </p>
          <div className="engine-account-entry">
            <Input
              label="API key"
              type="password"
              autoComplete="off"
              hint="Kept in the database and never shown again."
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={key.trim() === ""}
              loading={givingKey.isPending}
            >
              Save the key
            </Button>
            <Button variant="ghost" size="sm" onClick={() => ask(ASKING_NOTHING)}>
              Cancel
            </Button>
          </div>
          {givingKey.error && (
            <RefusalAlert title="The API key wasn't saved" error={givingKey.error} />
          )}
        </form>
      )}
    </div>
  );
}

/** A form here sends by `send`, never by the page's own submit. */
function submit(event: FormEvent, send: () => void): void {
  event.preventDefault();
  send();
}
