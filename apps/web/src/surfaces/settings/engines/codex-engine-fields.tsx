import { CODEX_MODELS, type CodexEngineEdit } from "@the-office/contracts";
import { Input, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";

/** A Codex engine's Settings: its name and default model, one of the Codex models. */
export function CodexEngineFields({
  edit,
  change,
}: {
  readonly edit: CodexEngineEdit;
  readonly change: (edit: CodexEngineEdit) => void;
}): ReactNode {
  return (
    <div className="engine-tab">
      <div className="engine-fields">
        <Input
          label="Name"
          hint={edit.id === undefined ? "One OpenAI account, signed in once saved." : undefined}
          value={edit.name}
          onChange={(event) => change({ ...edit, name: event.target.value })}
        />
        <Select
          label="Default model"
          options={CODEX_MODELS.map((model) => ({ value: model, label: modelLabel(model) }))}
          value={edit.defaultModel}
          onChange={(defaultModel) => change({ ...edit, defaultModel })}
        />
      </div>
    </div>
  );
}
