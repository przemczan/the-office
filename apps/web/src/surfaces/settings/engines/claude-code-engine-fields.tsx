import type { ClaudeCodeEngineEdit, EngineSettings } from "@the-office/contracts";
import { Input, Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { DefaultModelField } from "./engine-model-field.tsx";
import { EngineEffortField } from "./engine-effort-field.tsx";

/** A Claude Code engine's Settings: its name, Default model, Default effort and `-p` switch. */
export function ClaudeCodeEngineFields({
  edit,
  saved,
  change,
}: {
  readonly edit: ClaudeCodeEngineEdit;
  /** The engines as saved, whose lists give the models it offers. */
  readonly saved: EngineSettings;
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
        <DefaultModelField edit={edit} saved={saved} change={change} />
        <EngineEffortField
          kind={edit.kind}
          value={edit.defaultEffort}
          onChange={(defaultEffort) => change({ ...edit, defaultEffort })}
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
