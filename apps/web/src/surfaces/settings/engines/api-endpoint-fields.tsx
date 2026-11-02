import type { ApiEndpointModel, ApiEngine, ApiEngineEdit } from "@the-office/contracts";
import { Button, Icon, IconButton, Input, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  KEY_ON_SAVE_WORDS,
  keyOnSave,
  modelsOf,
  offeredDefaultModel,
} from "./engine-settings-draft.ts";

/** An API endpoint's fields: its name, base URL, key, models and default model. */
export function ApiEndpointFields({
  edit,
  saved,
  change,
  remove,
}: {
  readonly edit: ApiEngineEdit;
  /** Undefined while the endpoint isn't saved yet. */
  readonly saved: ApiEngine | undefined;
  readonly change: (edit: ApiEngineEdit) => void;
  readonly remove: () => void;
}): ReactNode {
  const called = edit.name === "" ? "the new API endpoint" : edit.name;
  const key = keyOnSave(edit, saved);
  const changeModel = (index: number, model: ApiEndpointModel): void =>
    change({ ...edit, models: edit.models.map((kept, at) => (at === index ? model : kept)) });
  return (
    <fieldset className="api-endpoint" aria-label={called}>
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
      </div>
      <div className="api-endpoint-models" role="group" aria-label={`Models of ${called}`}>
        {edit.models.map((model, index) => (
          // A model's id is what the user edits, so its place is its identity.
          <div key={index} className="api-endpoint-model">
            <Input
              label="Model"
              hint={index === 0 ? "Its id on the server." : undefined}
              value={model.id}
              onChange={(event) => changeModel(index, { ...model, id: event.target.value })}
            />
            <Input
              label="Context window"
              inputMode="numeric"
              suffix="tokens"
              value={model.contextWindow === 0 ? "" : String(model.contextWindow)}
              onChange={(event) =>
                changeModel(index, { ...model, contextWindow: Number(event.target.value) || 0 })
              }
            />
            <IconButton
              size="sm"
              icon={<Icon name="x" size={14} />}
              label={`Remove the model ${model.id || "without an id"}`}
              onClick={() =>
                change({ ...edit, models: edit.models.filter((_model, at) => at !== index) })
              }
            />
          </div>
        ))}
      </div>
      <div className="engine-fields">
        <Select
          label="Default model"
          placeholder="No model yet"
          options={[...modelsOf(edit)]}
          value={offeredDefaultModel(edit)}
          onChange={(defaultModel) => change({ ...edit, defaultModel })}
        />
      </div>
      <div className="engine-actions">
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={() =>
            change({ ...edit, models: [...edit.models, { id: "", contextWindow: 0 }] })
          }
        >
          Add a model
        </Button>
        <Button variant="danger-ghost" size="sm" onClick={remove}>
          Remove {called}
        </Button>
      </div>
    </fieldset>
  );
}

/** The endpoint with `key` as saving takes it: undefined keeps the one kept, empty removes it. */
function withKey(edit: ApiEngineEdit, key: string | undefined): ApiEngineEdit {
  const { key: _kept, ...rest } = edit;
  return key === undefined ? rest : { ...rest, key };
}
