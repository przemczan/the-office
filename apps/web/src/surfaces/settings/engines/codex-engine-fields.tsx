import type { CodexEngineEdit, EngineSettings } from "@the-office/contracts";
import { Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { DefaultModelField } from "./engine-model-field.tsx";
import { EngineEffortField } from "./engine-effort-field.tsx";

/** A Codex engine's Settings: its name, Default model, one it offers, and Default effort. */
export function CodexEngineFields({
  edit,
  saved,
  change,
}: {
  readonly edit: CodexEngineEdit;
  /** The engines as saved, whose lists give the models it offers. */
  readonly saved: EngineSettings;
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
        <DefaultModelField edit={edit} saved={saved} change={change} />
        <EngineEffortField
          kind={edit.kind}
          value={edit.defaultEffort}
          onChange={(defaultEffort) => change({ ...edit, defaultEffort })}
        />
      </div>
    </div>
  );
}
