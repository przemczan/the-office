import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EngineEdit,
  EngineId,
  EngineSettings,
  EngineSettingsEdit,
} from "@the-office/contracts";
import { Button, Card, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeEngineSettings, engineSettingsQuery } from "../../../api/engine.ts";
import { ENGINE_CASCADE, roleCardQueries, roleQueries } from "../../../api/people.ts";
import { projectQueries } from "../../../api/projects.ts";
import { usageSettingsQuery } from "../../../api/work.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsProblem } from "../settings-card-parts.tsx";
import { DefaultsCard } from "./defaults-card.tsx";
import { EngineDetail } from "./engine-detail.tsx";
import { EngineList } from "./engine-list.tsx";
import {
  draftedIdAt,
  engineAt,
  engineProblem,
  engineSelectionsOf,
  engineTabsOf,
  pricedModelsAt,
  saveHeldBy,
  shownSelection,
  withEngineChanged,
  withoutEngine,
  type EngineSelection,
  type EngineTab,
} from "./engine-list-words.ts";
import {
  claudeModelsOf,
  draftChanged,
  draftedEngines,
  draftOf,
  engineSettingsEditOf,
  NEW_API_ENDPOINT,
  newClaudeCodeEngine,
  newCodexEngine,
  officeDefaultChoicesOf,
  offeredModelKey,
  priceTextIn,
  savedApiEngines,
  standInsOf,
  type EngineSettingsDraft,
} from "./engine-settings-draft.ts";
import { RemoveEngineDialog } from "./remove-engine-dialog.tsx";
import { StandInEnginesCard } from "./stand-in-engines-card.tsx";
import "./engines.css";

/**
 * Settings › Engines: the Defaults (the Office default and the Search endpoint) and the Stand-in
 * Engines above the list of engines beside the selected one's tabs, one draft saved whole.
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
  // An engine added since the last Save has no id yet, so the selection is its place in the draft.
  const [selection, setSelection] = useState<EngineSelection | undefined>();
  const [tab, setTab] = useState<EngineTab>("settings");
  const dirty = draftChanged(draft, saved);
  const toSave = engineSettingsEditOf(draft, saved);
  const held = toSave === undefined ? saveHeldBy(draft, saved) : undefined;
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

  // A removal or a Discard may take the selected engine away: its neighbour shows instead.
  const shown = shownSelection(draft, selection);
  const engine = shown && engineAt(draft, shown);
  const shownTab = engine && engineTabsOf(engine.kind).includes(tab) ? tab : "settings";
  const select = (next: EngineSelection, nextTab: EngineTab = tab): void => {
    setSelection(next);
    setTab(nextTab);
  };
  const changeEngine = (at: EngineSelection, edit: EngineEdit): void =>
    setDraft(withEngineChanged(draft, at, edit));
  // A saved engine is removed by its dialog, which moves what names it.
  const removeEngine = (at: EngineSelection, edit: EngineEdit): void => {
    if (edit.id !== undefined) {
      setRemoving(edit.id);
      return;
    }
    setDraft(withoutEngine(draft, at));
  };
  const drafted = draftedEngines(draft, saved);
  const standIns = standInsOf(draft, saved);
  return (
    <>
      <DefaultsCard
        officeDefault={draft.officeDefault}
        choices={officeDefaultChoicesOf(draft, saved)}
        searchEndpoint={draft.searchEndpoint}
        changeOfficeDefault={(officeDefault) => setDraft({ ...draft, officeDefault })}
        changeSearchEndpoint={(searchEndpoint) => setDraft({ ...draft, searchEndpoint })}
      />
      <StandInEnginesCard
        listed={standIns.listed}
        addable={standIns.addable}
        askBeforeSwitchAbove={draft.askBeforeSwitchAbove}
        changeStandInEngines={(standInEngines) => setDraft({ ...draft, standInEngines })}
        changeAskBeforeSwitchAbove={(askBeforeSwitchAbove) =>
          setDraft({ ...draft, askBeforeSwitchAbove })
        }
      />
      <div className="settings-split">
        <EngineList
          rows={engineSelectionsOf(draft).flatMap((at) => {
            const listed = engineAt(draft, at);
            return listed
              ? [
                  {
                    selection: at,
                    engine: listed,
                    officeDefault:
                      listed.id !== undefined && listed.id === draft.officeDefault?.engineId,
                    problem: engineProblem(draft, saved, at),
                  },
                ]
              : [];
          })}
          shown={shown}
          select={(at) => select(at)}
          add={{
            "claude-code": () => {
              setDraft({
                ...draft,
                claudeCodeEngines: [...draft.claudeCodeEngines, newClaudeCodeEngine(saved)],
              });
              select({ kind: "claude-code", index: draft.claudeCodeEngines.length }, "settings");
            },
            codex: () => {
              setDraft({ ...draft, codexEngines: [...draft.codexEngines, newCodexEngine(saved)] });
              select({ kind: "codex", index: draft.codexEngines.length }, "settings");
            },
            "openai-compatible-api": () => {
              setDraft({ ...draft, apiEndpoints: [...draft.apiEndpoints, NEW_API_ENDPOINT] });
              select(
                { kind: "openai-compatible-api", index: draft.apiEndpoints.length },
                "settings",
              );
            },
          }}
        />
        <div className="library-detail">
          {shown && engine ? (
            <EngineDetail
              // Each engine starts on its own fields, never another's left in place.
              key={`${shown.kind}-${shown.index}`}
              engine={engine}
              tab={shownTab}
              selectTab={setTab}
              claudeModels={claudeModelsOf(saved)}
              savedEndpoint={savedApiEngines(saved.engines).find(({ id }) => id === engine.id)}
              pricedModels={pricedModelsAt(draft, saved, shown)}
              draftedId={draftedIdAt(drafted, shown)}
              prices={{
                priceTextOf: (model) => priceTextIn(draft, model),
                change: (model, text) =>
                  setDraft({
                    ...draft,
                    modelPrices: { ...draft.modelPrices, [offeredModelKey(model)]: text },
                  }),
              }}
              change={(edit) => changeEngine(shown, edit)}
              remove={() => removeEngine(shown, engine)}
            />
          ) : (
            <Card>
              <p className="settings-note">
                No engine is listed, so no session starts. Add one with "Add an engine".
              </p>
            </Card>
          )}
        </div>
      </div>
      {saving.error && <RefusalAlert title="The engines weren't saved" error={saving.error} />}
      <div className="settings-actions">
        {held ? (
          <span className="settings-actions-state engine-save-held" role="status">
            <Icon name="triangle-alert" size={14} />
            {held.line}
            {held.selection && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => held.selection && select(held.selection, "prices")}
              >
                Show it
              </Button>
            )}
          </span>
        ) : (
          <span className="settings-actions-state">{dirty ? "Unsaved changes" : "Saved"}</span>
        )}
        <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(draftOf(saved))}>
          Discard
        </Button>
        <Button
          loading={saving.isPending}
          // The Save bar names the engine whose price holds it.
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
