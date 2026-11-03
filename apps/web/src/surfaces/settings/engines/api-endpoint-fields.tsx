import type { ApiEngine, ApiEngineEdit } from "@the-office/contracts";
import { Button, Input, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  KEY_ON_SAVE_WORDS,
  keyOnSave,
  modelsOf,
  offeredDefaultModel,
} from "./engine-settings-draft.ts";

/**
 * An API endpoint's Settings: its name, base URL, key and default model; its models are under
 * Models and prices.
 */
export function ApiEndpointFields({
  edit,
  saved,
  change,
}: {
  readonly edit: ApiEngineEdit;
  /** Undefined while the endpoint isn't saved yet. */
  readonly saved: ApiEngine | undefined;
  readonly change: (edit: ApiEngineEdit) => void;
}): ReactNode {
  const key = keyOnSave(edit, saved);
  return (
    <div className="engine-tab">
      <div className="engine-fields">
        <Input
          label="Name"
          value={edit.name}
          onChange={(event) => change({ ...edit, name: event.target.value })}
        />
        <Input
          label="Base URL"
          placeholder="http://127.0.0.1:8080/v1"
          value={edit.baseUrl}
          onChange={(event) => change({ ...edit, baseUrl: event.target.value })}
        />
      </div>
      <div className="engine-fields">
        <Input
          label="Key"
          type="password"
          autoComplete="off"
          hint={KEY_ON_SAVE_WORDS[key]}
          value={edit.key ?? ""}
          // Emptying the field keeps the key; only "Remove the key" removes it.
          onChange={({ target: { value } }) => change(withKey(edit, value || undefined))}
          suffix={
            key === "kept-set" ? (
              <Button variant="ghost" size="sm" onClick={() => change(withKey(edit, ""))}>
                Remove the key
              </Button>
            ) : key === "removed" ? (
              <Button variant="ghost" size="sm" onClick={() => change(withKey(edit, undefined))}>
                Keep the key
              </Button>
            ) : undefined
          }
        />
        <Select
          label="Default model"
          placeholder="No model yet"
          hint="One of its models, listed under Models and prices."
          options={[...modelsOf(edit)]}
          value={offeredDefaultModel(edit)}
          onChange={(defaultModel) => change({ ...edit, defaultModel })}
        />
      </div>
    </div>
  );
}

/** The endpoint with `key` as saving takes it: undefined keeps the one kept, empty removes it. */
function withKey(edit: ApiEngineEdit, key: string | undefined): ApiEngineEdit {
  const { key: _kept, ...rest } = edit;
  return key === undefined ? rest : { ...rest, key };
}
