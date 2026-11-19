import { COPILOT_CLI_MODELS, type CopilotCliEngineEdit } from "@the-office/contracts";
import { Input, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";

/** A Copilot CLI engine's Settings: its name and default model, one of the Copilot CLI models. */
export function CopilotCliEngineFields({
  edit,
  change,
}: {
  readonly edit: CopilotCliEngineEdit;
  readonly change: (edit: CopilotCliEngineEdit) => void;
}): ReactNode {
  return (
    <div className="engine-tab">
      <div className="engine-fields">
        <Input
          label="Name"
          hint={edit.id === undefined ? "One GitHub account, signed in once saved." : undefined}
          value={edit.name}
          onChange={(event) => change({ ...edit, name: event.target.value })}
        />
        <Select
          label="Default model"
          options={COPILOT_CLI_MODELS.map((model) => ({ value: model, label: modelLabel(model) }))}
          value={edit.defaultModel}
          onChange={(defaultModel) => change({ ...edit, defaultModel })}
        />
      </div>
    </div>
  );
}
