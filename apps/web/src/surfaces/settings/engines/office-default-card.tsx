import type { EngineModel } from "@the-office/contracts";
import { Card, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import type { OfficeDefaultChoice } from "./engine-settings-draft.ts";

/**
 * The Office default: an engine and one of its models; picking an engine fills in its default model.
 * None while no engine is listed, until the first one saved takes it.
 */
export function OfficeDefaultCard({
  officeDefault,
  choices,
  change,
}: {
  readonly officeDefault: EngineModel | null;
  readonly choices: readonly OfficeDefaultChoice[];
  readonly change: (officeDefault: EngineModel) => void;
}): ReactNode {
  return (
    <Card title={<SettingsCardTitle icon="cpu">Office default</SettingsCardTitle>}>
      <p className="settings-note">
        The engine and model every session runs on unless something more specific names another. A
        new engine can be picked once saved.
      </p>
      {officeDefault ? (
        <OfficeDefaultFields officeDefault={officeDefault} choices={choices} change={change} />
      ) : (
        <p className="settings-note">
          No engine is listed, so no session starts. The first engine saved becomes the Office
          default, on its default model.
        </p>
      )}
    </Card>
  );
}

function OfficeDefaultFields({
  officeDefault,
  choices,
  change,
}: {
  readonly officeDefault: EngineModel;
  readonly choices: readonly OfficeDefaultChoice[];
  readonly change: (officeDefault: EngineModel) => void;
}): ReactNode {
  const engine = choices.find(({ id }) => id === officeDefault.engineId);
  return (
    <div className="engine-fields" role="group" aria-label="Office default">
      <Select
        label="Engine"
        options={choices.map(({ id, name }) => ({ value: id, label: name }))}
        value={officeDefault.engineId}
        onChange={(engineId) =>
          change({
            engineId,
            model: choices.find(({ id }) => id === engineId)?.defaultModel ?? "",
          })
        }
      />
      <Select
        label="Model"
        options={(engine?.models ?? []).map((model) => ({
          value: model,
          label: modelLabel(model),
        }))}
        value={officeDefault.model}
        onChange={(model) => change({ ...officeDefault, model })}
      />
    </div>
  );
}
