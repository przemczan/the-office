import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EngineModelList, EngineSettings } from "@the-office/contracts";
import { Button, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { engineSettingsQuery, refreshEngineModels } from "../../../api/engine.ts";
import { roleCardQueries } from "../../../api/people.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import {
  defaultModelChoicesOf,
  defaultModelNoLongerOffered,
  type ListingEngineEdit,
} from "./engine-settings-draft.ts";
import { modelsListedWords } from "./engine-model-words.ts";

/**
 * A Claude Code, Codex, Copilot CLI or Gemini CLI engine's Default model: the models it offers now,
 * and a default it no longer offers kept, marked "No longer offered".
 */
export function DefaultModelField<Edit extends ListingEngineEdit>({
  edit,
  saved,
  change,
}: {
  readonly edit: Edit;
  readonly saved: EngineSettings;
  readonly change: (edit: Edit) => void;
}): ReactNode {
  return (
    <Select
      label="Default model"
      options={[...defaultModelChoicesOf(saved, edit)]}
      value={edit.defaultModel}
      hint={
        defaultModelNoLongerOffered(saved, edit)
          ? "The engine no longer offers it. It stays until another is picked."
          : undefined
      }
      onChange={(defaultModel) => change({ ...edit, defaultModel })}
    />
  );
}

/**
 * A saved engine's models whose account lists them: when they were listed, or that its type's fixed
 * list stands in, with Refresh models.
 */
export function EngineModelsRefresh({
  modelList,
}: {
  readonly modelList: EngineModelList;
}): ReactNode {
  const queryClient = useQueryClient();
  const refreshing = useMutation({
    mutationFn: () => refreshEngineModels(modelList.engineId),
    // `engine.models-listed` reads them again too; this one doesn't wait for it.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: engineSettingsQuery().queryKey, exact: true }),
        queryClient.invalidateQueries(roleCardQueries.options()),
      ]),
  });
  return (
    <div className="engine-models-refresh">
      <div className="engine-models-refresh-row">
        <span className="engine-models-listed">{modelsListedWords(modelList.listedAt)}</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={refreshing.isPending}
          onClick={() => refreshing.mutate()}
        >
          Refresh models
        </Button>
      </div>
      {refreshing.error && (
        <RefusalAlert title="The models weren't listed" error={refreshing.error} />
      )}
    </div>
  );
}
