import type { ClaudeCodeEngineEdit } from "@the-office/contracts";
import { Button, Input, Select, Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";
import { ClaudeCodeEngineAccount } from "./claude-code-engine-account.tsx";

/**
 * A Claude Code engine's fields: its name, default model and `-p` switch, and once saved its
 * account (one not saved has no folder to sign in yet).
 */
export function ClaudeCodeEngineFields({
  edit,
  claudeModels,
  change,
  remove,
}: {
  readonly edit: ClaudeCodeEngineEdit;
  readonly claudeModels: readonly string[];
  readonly change: (edit: ClaudeCodeEngineEdit) => void;
  /** Drops one not saved yet from the draft; opens the remove dialog for a saved one. */
  readonly remove: () => void;
}): ReactNode {
  const called = edit.name === "" ? "the new Claude Code engine" : edit.name;
  return (
    <fieldset className="claude-code-engine" aria-label={called}>
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
      {edit.id !== undefined && <ClaudeCodeEngineAccount key={edit.id} engineId={edit.id} />}
      <div className="engine-actions">
        <Button variant="danger-ghost" size="sm" onClick={remove}>
          Remove {called}
        </Button>
      </div>
    </fieldset>
  );
}
