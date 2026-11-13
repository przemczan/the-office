import { useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Button, Card } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { SIGN_IN_PATH, signInWithCode } from "../../api/users.ts";
import {
  CodeAnswerField,
  CodeRefusalAlert,
  NO_CODE_ANSWER,
  codeAnswerOf,
  useCodeRefusal,
  type CodeAnswerDraft,
} from "../../shell/code-answer-field.tsx";
import { OfficeName } from "./office-name.tsx";
import { useSignedIn } from "./use-signed-in.ts";
import "./sign-in.css";

/**
 * The code page, outside the shell (spec §2.10): after a password, Continue with GitHub or Continue
 * with Google, a user whose authenticator is on types its code, or a recovery code instead. A
 * refusal shows the service's words and, once wrong tries cost a wait, when to try again. Once the
 * pending sign-in has ended, the service's 401 sends the browser back to sign in.
 */
export function CodePage(): ReactNode {
  const [draft, setDraft] = useState<CodeAnswerDraft>(NO_CODE_ANSWER);
  const returnTo = useSearch({ from: "/sign-in/code", select: (search) => search.returnTo });
  const signedIn = useSignedIn();
  const signingIn = useMutation({
    mutationFn: () => signInWithCode(codeAnswerOf(draft)),
    onSuccess: (outcome) => (outcome.outcome === "set-password" ? undefined : signedIn(outcome)),
  });
  const refusal = useCodeRefusal(signingIn.error);
  const waitWords = refusal?.waitWords;
  return (
    <main className="sign-in-page">
      <div className="sign-in-column">
        <OfficeName />
        <h1>Authenticator code</h1>
        <p className="sign-in-lead">
          Your authenticator is on: open its app and type the code it shows for The Office.
        </p>
        <Card>
          <form
            className="sign-in-form"
            aria-label="Sign in with the authenticator code"
            onSubmit={(event) => {
              event.preventDefault();
              signingIn.mutate();
            }}
          >
            {refusal && <CodeRefusalAlert refusal={refusal} />}
            <CodeAnswerField
              draft={draft}
              onChange={(changed) => {
                setDraft(changed);
                if (changed.kind !== draft.kind) signingIn.reset();
              }}
              autoFocus
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
        </Card>
        <Link
          className="sign-in-back"
          to={SIGN_IN_PATH}
          search={returnTo === undefined ? {} : { returnTo }}
        >
          ‹ Back to sign in
        </Link>
      </div>
    </main>
  );
}
