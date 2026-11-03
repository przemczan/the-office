import type { ClaudeCodeEngineEdit } from "@the-office/contracts";
import { Input, Select, Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";

/** A Claude Code engine's Settings: its name, default model and `-p` switch. */
export function ClaudeCodeEngineFields({
  edit,
  claudeModels,
  change,
}: {
  readonly edit: ClaudeCodeEngineEdit;
  readonly claudeModels: readonly string[];
  readonly change: (edit: ClaudeCodeEngineEdit) => void;
}): ReactNode {
  return (
    <div className="engine-tab">
      <div className="engine-fields">
        <Input
          label="Name"
          hint={edit.id === undefined ? "One Claude account, signed in once saved." : undefined}
          value={edit.name}
          onChange={(event) => change({ ...edit, name: event.target.value })}
        />
        <Select
          label="Default model"
          options={claudeModels.map((model) => ({ value: model, label: modelLabel(model) }))}
          value={edit.defaultModel}
          onChange={(defaultModel) => change({ ...edit, defaultModel })}
        />
      </div>
      <Switch
        label="The -p fallback"
        description="Its sessions run on claude -p in place of the Agent SDK."
        checked={edit.claudeCodeP}
        onChange={(claudeCodeP) => change({ ...edit, claudeCodeP })}
      />
    </div>
  );
}
