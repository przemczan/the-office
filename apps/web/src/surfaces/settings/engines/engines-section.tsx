import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiEndpoint,
  ApiEndpointEdit,
  ApiEndpointModel,
  EngineSettings,
  EngineSettingsEdit,
} from "@the-office/contracts";
import { Button, Card, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeEngineSettings, engineSettingsQuery } from "../../../api/engine.ts";
import { roleCardQueries } from "../../../api/people.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import {
  draftOf,
  KEY_ON_SAVE_WORDS,
  keyOnSave,
  NEW_API_ENDPOINT,
  searchEndpointOf,
} from "./engine-settings-draft.ts";
import "./engines.css";

/** Settings › Engines: the API endpoints of the OpenAI-compatible API and the Search endpoint. */
export function EnginesSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Engines" });
  const settings = useQuery(engineSettingsQuery());
  return (
    <>
      {settings.data && <EngineSettingsForm saved={settings.data} />}
      <SettingsProblem title="The engines' settings can't be read" error={settings.error} />
    </>
  );
}

function EngineSettingsForm({ saved }: { readonly saved: EngineSettings }): ReactNode {
  const [draft, setDraft] = useState<EngineSettingsEdit>(() => draftOf(saved));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => changeEngineSettings(draft),
    onSuccess: async (result) => {
      queryClient.setQueryData(engineSettingsQuery().queryKey, result);
      setDraft(draftOf(result));
      // The Role card offers the API endpoints' models.
      await queryClient.invalidateQueries(roleCardQueries.options());
      showToast("Engines saved. Sessions started from now on use them.");
    },
  });
  const changeEndpoint = (index: number, edit: ApiEndpointEdit): void =>
    setDraft({
      ...draft,
      apiEndpoints: draft.apiEndpoints.map((endpoint, at) => (at === index ? edit : endpoint)),
    });
  return (
    <>
      <Card title={<SettingsCardTitle icon="server">API endpoints</SettingsCardTitle>}>
        <p className="settings-note">
          Servers on the OpenAI-compatible API, such as a local LLM. A Role on the OpenAI-compatible
          API works on one of their models, picked in its Model field.
        </p>
        <div className="api-endpoints">
          {draft.apiEndpoints.map((endpoint, index) => (
            <ApiEndpointFields
              // An endpoint added since the last Save has no id yet, so its place is its identity.
              key={index}
              edit={endpoint}
              saved={saved.apiEndpoints.find(({ id }) => id === endpoint.id)}
              change={(edit) => changeEndpoint(index, edit)}
              remove={() =>
                setDraft({
                  ...draft,
                  apiEndpoints: draft.apiEndpoints.filter((_endpoint, at) => at !== index),
                })
              }
            />
          ))}
        </div>
        <div>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() =>
              setDraft({ ...draft, apiEndpoints: [...draft.apiEndpoints, NEW_API_ENDPOINT] })
            }
          >
            Add an API endpoint
          </Button>
        </div>
      </Card>
      <Card title={<SettingsCardTitle icon="search">Search endpoint</SettingsCardTitle>}>
        <Input
          label="Base URL"
          hint="SearXNG, with json among its search formats. WebSearch on the OpenAI-compatible API goes through it, and is refused while none is set."
          placeholder="http://127.0.0.1:8888"
          value={draft.searchEndpoint?.baseUrl ?? ""}
          onChange={(event) =>
            setDraft({ ...draft, searchEndpoint: searchEndpointOf(event.target.value) })
          }
        />
      </Card>
      {saving.error && <RefusalAlert title="The engines weren't saved" error={saving.error} />}
      <div className="settings-actions">
        <span className="settings-actions-state">{dirty ? "Unsaved changes" : "Saved"}</span>
        <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(draftOf(saved))}>
          Discard
        </Button>
        <Button loading={saving.isPending} disabled={!dirty} onClick={() => saving.mutate()}>
          Save
        </Button>
      </div>
    </>
  );
}

function ApiEndpointFields({
  edit,
  saved,
  change,
  remove,
}: {
  readonly edit: ApiEndpointEdit;
  /** Undefined while the endpoint isn't saved yet. */
  readonly saved: ApiEndpoint | undefined;
  readonly change: (edit: ApiEndpointEdit) => void;
  readonly remove: () => void;
}): ReactNode {
  const called = edit.name === "" ? "the new API endpoint" : edit.name;
  const key = keyOnSave(edit, saved);
  const changeModel = (index: number, model: ApiEndpointModel): void =>
    change({ ...edit, models: edit.models.map((kept, at) => (at === index ? model : kept)) });
  return (
    <fieldset className="api-endpoint" aria-label={called}>
      <div className="api-endpoint-fields">
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
      <div className="api-endpoint-actions">
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
function withKey(edit: ApiEndpointEdit, key: string | undefined): ApiEndpointEdit {
  const { key: _kept, ...rest } = edit;
  return key === undefined ? rest : { ...rest, key };
}
