import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACTIONS_AT_ONCE } from "@the-office/contracts";
import { Card, Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import { actionRunQueries, changeActionSettings } from "../../../api/action-runs.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

const ACTIONS_AT_ONCE_HINT =
  "How many Project command runs of Actions may be running together across The Office. A Test target run counts as a test instance instead, a Workflow run toward neither.";
const ACTIONS_AT_ONCE_FOOT =
  "Lowering it stops none: the next start is refused until fewer are running.";

/**
 * Settings › Office limits' Actions card (screens/settings.md, "Office limits"): Actions at once,
 * saved at each step.
 */
export function ActionsCard(): ReactNode {
  const queryClient = useQueryClient();
  const settings = useQuery(actionRunQueries.settings());
  const saving = useMutation({
    mutationFn: changeActionSettings,
    onSuccess: (saved) => queryClient.setQueryData(actionRunQueries.settings().queryKey, saved),
  });
  return (
    <Card title={<SettingsCardTitle icon="play">Actions</SettingsCardTitle>}>
      <div className="stepper-row">
        <div className="stepper-row-words">
          <b>Actions at once</b>
          <p className="settings-note">{ACTIONS_AT_ONCE_HINT}</p>
        </div>
        {settings.data && (
          <Stepper
            label="Actions at once"
            value={settings.data.actionsAtOnce}
            min={ACTIONS_AT_ONCE.min}
            max={ACTIONS_AT_ONCE.max}
            disabled={saving.isPending}
            onChange={(actionsAtOnce) => saving.mutate({ actionsAtOnce })}
          />
        )}
      </div>
      <p className="settings-note stepper-note">{ACTIONS_AT_ONCE_FOOT}</p>
      <SettingsProblem title="Actions at once can't be read" error={settings.error} />
      <SettingsProblem title="Actions at once can't be saved" error={saving.error} />
    </Card>
  );
}
