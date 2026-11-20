import { GEMINI_CLI_MODELS, type GeminiCliEngineEdit } from "@the-office/contracts";
import { Input, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";

/** A Gemini CLI engine's Settings: its name and default model, one of the Gemini CLI models. */
export function GeminiCliEngineFields({
  edit,
  change,
}: {
  readonly edit: GeminiCliEngineEdit;
  readonly change: (edit: GeminiCliEngineEdit) => void;
}): ReactNode {
  return (
    <div className="engine-tab">
      <div className="engine-fields">
        <Input
          label="Name"
          hint={edit.id === undefined ? "One Gemini API key, set once saved." : undefined}
          value={edit.name}
          onChange={(event) => change({ ...edit, name: event.target.value })}
        />
        <Select
          label="Default model"
          options={GEMINI_CLI_MODELS.map((model) => ({
            value: model,
            label: modelLabel(model),
          }))}
          value={edit.defaultModel}
          onChange={(defaultModel) => change({ ...edit, defaultModel })}
        />
      </div>
    </div>
  );
}
