import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiEngineEdit,
  ClaudeCodeEngineEdit,
  EngineId,
  EngineSettings,
  EngineSettingsEdit,
} from "@the-office/contracts";
import { Button, Card, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeEngineSettings, engineSettingsQuery } from "../../../api/engine.ts";
import { ENGINE_CASCADE, roleCardQueries, roleQueries } from "../../../api/people.ts";
import { projectQueries } from "../../../api/projects.ts";
import { usageSettingsQuery } from "../../../api/work.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import { ApiEndpointFields } from "./api-endpoint-fields.tsx";
import { ClaudeCodeEngineFields } from "./claude-code-engine-fields.tsx";
import {
  claudeModelsOf,
  draftChanged,
  draftedEngines,
  draftOf,
  engineSettingsEditOf,
  NEW_API_ENDPOINT,
  newClaudeCodeEngine,
  officeDefaultChoicesOf,
  offeredModelKey,
  offeredModelsOf,
  priceTextIn,
  savedApiEngines,
  searchEndpointOf,
  type EngineSettingsDraft,
} from "./engine-settings-draft.ts";
import { ModelPricesCard } from "./model-prices-card.tsx";
import { OfficeDefaultCard } from "./office-default-card.tsx";
import { RemoveEngineDialog } from "./remove-engine-dialog.tsx";
import "./engines.css";

/**
 * Settings › Engines: the engines, the Office default, the Search endpoint and the Model prices,
 * one draft saved whole.
 */
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
  const [draft, setDraft] = useState<EngineSettingsDraft>(() => draftOf(saved));
  const dirty = draftChanged(draft, saved);
  const toSave = engineSettingsEditOf(draft, saved);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [removing, setRemoving] = useState<EngineId | undefined>();
  const takeSaved = async (result: EngineSettings): Promise<void> => {
    queryClient.setQueryData(engineSettingsQuery().queryKey, result);
    setDraft(draftOf(result));
    // The Role card offers each engine's models and says what the Office default gives; the
    // Usage card has caps for each engine.
    await Promise.all([
      queryClient.invalidateQueries(roleCardQueries.options()),
      queryClient.invalidateQueries({ queryKey: ENGINE_CASCADE }),
      queryClient.invalidateQueries(usageSettingsQuery()),
    ]);
  };
  const saving = useMutation({
    mutationFn: (sent: EngineSettingsEdit) => changeEngineSettings(sent),
    onSuccess: async (result) => {
      await takeSaved(result);
      showToast("Engines saved. Sessions started from now on use them.");
    },
  });
  const takeRemoval = async (left: EngineSettings): Promise<void> => {
    // The removal moved Role overrides and Project levels too.
    await Promise.all([
      takeSaved(left),
      queryClient.invalidateQueries(roleQueries.list()),
      queryClient.invalidateQueries(projectQueries.list()),
    ]);
    showToast("Engine removed. What named it moved to the replacement.");
  };
  const changeClaudeCodeEngine = (index: number, edit: ClaudeCodeEngineEdit): void =>
    setDraft({
      ...draft,
      claudeCodeEngines: draft.claudeCodeEngines.map((engine, at) =>
        at === index ? edit : engine,
      ),
    });
  const changeEndpoint = (index: number, edit: ApiEngineEdit): void =>
    setDraft({
      ...draft,
      apiEndpoints: draft.apiEndpoints.map((endpoint, at) => (at === index ? edit : endpoint)),
    });
  return (
    <>
      <Card title={<SettingsCardTitle icon="server">Engines</SettingsCardTitle>}>
        <p className="settings-note">
          What sessions run on: each Claude Code engine is one Claude account, each API endpoint a
          server on the OpenAI-compatible API, such as a local LLM.
        </p>
        <div className="engines">
          {draft.claudeCodeEngines.map((engine, index) => (
            <ClaudeCodeEngineFields
              // An engine added since the last Save has no id yet, so its place is its identity.
              key={index}
              edit={engine}
              claudeModels={claudeModelsOf(saved)}
              change={(edit) => changeClaudeCodeEngine(index, edit)}
              // A saved engine is removed by its dialog, which moves what names it.
              remove={() =>
                engine.id === undefined
                  ? setDraft({
                      ...draft,
                      claudeCodeEngines: draft.claudeCodeEngines.filter(
                        (_engine, at) => at !== index,
                      ),
                    })
                  : setRemoving(engine.id)
              }
            />
          ))}
          {draft.apiEndpoints.map((endpoint, index) => (
            <ApiEndpointFields
              key={index}
              edit={endpoint}
              saved={savedApiEngines(saved.engines).find(({ id }) => id === endpoint.id)}
              change={(edit) => changeEndpoint(index, edit)}
              remove={() =>
                endpoint.id === undefined
                  ? setDraft({
                      ...draft,
                      apiEndpoints: draft.apiEndpoints.filter((_endpoint, at) => at !== index),
                    })
                  : setRemoving(endpoint.id)
              }
            />
          ))}
        </div>
        <div className="engines-add">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() =>
              setDraft({
                ...draft,
                claudeCodeEngines: [...draft.claudeCodeEngines, newClaudeCodeEngine(saved)],
              })
            }
          >
            Add a Claude Code engine
          </Button>
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
      <OfficeDefaultCard
        officeDefault={draft.officeDefault}
        choices={officeDefaultChoicesOf(draft, saved)}
        change={(officeDefault) => setDraft({ ...draft, officeDefault })}
      />
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
      <ModelPricesCard
        offered={offeredModelsOf(draft, saved)}
        apiEndpoints={draftedEngines(draft, saved).apiEndpoints}
        priceTextOf={(model) => priceTextIn(draft, model)}
        change={(model, text) =>
          setDraft({
            ...draft,
            modelPrices: { ...draft.modelPrices, [offeredModelKey(model)]: text },
          })
        }
      />
      {saving.error && <RefusalAlert title="The engines weren't saved" error={saving.error} />}
      <div className="settings-actions">
        <span className="settings-actions-state">{dirty ? "Unsaved changes" : "Saved"}</span>
        <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(draftOf(saved))}>
          Discard
        </Button>
        <Button
          loading={saving.isPending}
          // A Model price's fields show what holds it.
          disabled={!dirty || toSave === undefined}
          onClick={() => toSave && saving.mutate(toSave)}
        >
          Save
        </Button>
      </div>
      {removing !== undefined && (
        <RemoveEngineDialog
          engineId={removing}
          saved={saved}
          unsavedChanges={dirty}
          onRemoved={takeRemoval}
          onClose={() => setRemoving(undefined)}
        />
      )}
    </>
  );
}
