import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  engineAccountQuery,
  signOutOfEngine,
  useEngineAccountChanged,
} from "../../../api/engine.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { EngineApiKeyForm } from "./engine-api-key-form.tsx";
import { geminiCliAccountLine } from "./engine-account-words.ts";

/**
 * A saved Gemini CLI engine's account: its line, a Gemini API key from Google AI Studio as its only
 * sign-in (`engine-api-key-form.tsx`, the key never in the draft nor shown again) and Sign out,
 * which forgets the key. Read again on each change and on `engine.account-changed`.
 */
export function GeminiCliEngineAccount({ engineId }: { readonly engineId: string }): ReactNode {
  const queryClient = useQueryClient();
  const account = useQuery(engineAccountQuery(engineId));
  const [asking, setAsking] = useState(false);

  const accountChanged = () => {
    setAsking(false);
    return queryClient.invalidateQueries(engineAccountQuery(engineId));
  };
  const signingOut = useMutation({
    mutationFn: () => signOutOfEngine(engineId),
    onSuccess: accountChanged,
  });
  useEngineAccountChanged(engineId, () => setAsking(false));

  return (
    <div className="engine-account" role="group" aria-label="Account">
      <div className="engine-account-status">
        <span className="engine-account-line">
          {account.data
            ? geminiCliAccountLine(account.data)
            : account.isPending
              ? "Reading the account…"
              : ""}
        </span>
        <div className="engine-account-actions">
          {!asking && (
            <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
              {account.data?.signedIn ? "Use another API key" : "Use an API key"}
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
      {signingOut.error && <RefusalAlert title="It wasn't signed out" error={signingOut.error} />}
      {asking && (
        <EngineApiKeyForm
          engineId={engineId}
          hint={
            <>
              Make a Gemini API key in Google AI Studio and paste it here. It is the only way to
              sign a Gemini CLI engine in.
            </>
          }
          keptWhere="Kept in the database"
          saveLabel="Save the key"
          saved={accountChanged}
          cancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
