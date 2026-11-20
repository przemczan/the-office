import { useMutation } from "@tanstack/react-query";
import { Button, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { setEngineApiKey } from "../../../api/engine.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";

/**
 * An engine's API key form: a password field, saved by `PUT …/api-key`, the service's words on a
 * refusal. The key is held here only, never in the engines' draft, and is emptied once saved; the
 * form going away (Cancel, or `saved` closing it) forgets it with any refusal.
 */
export function EngineApiKeyForm({
  engineId,
  hint,
  keptWhere,
  saveLabel,
  saved,
  cancel,
}: {
  readonly engineId: string;
  /** What signs the engine in, said above the field. */
  readonly hint: ReactNode;
  /** Where The Office keeps the key, said under the field. */
  readonly keptWhere: string;
  readonly saveLabel: string;
  readonly saved: () => unknown;
  readonly cancel: () => void;
}): ReactNode {
  const [key, setKey] = useState("");
  const givingKey = useMutation({
    mutationFn: (typed: string) => setEngineApiKey(engineId, typed),
    onSuccess: () => {
      setKey("");
      return saved();
    },
  });

  return (
    <form
      className="engine-account-form"
      onSubmit={(event) => {
        event.preventDefault();
        givingKey.mutate(key);
      }}
    >
      <p className="engine-account-hint">{hint}</p>
      <div className="engine-account-entry">
        <Input
          label="API key"
          type="password"
          autoComplete="off"
          hint={`${keptWhere} and never shown again.`}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={key.trim() === ""} loading={givingKey.isPending}>
          {saveLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
      </div>
      {givingKey.error && <RefusalAlert title="The API key wasn't saved" error={givingKey.error} />}
    </form>
  );
}
