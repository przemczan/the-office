import type { CopilotCliEngineEdit, EngineSettings } from "@the-office/contracts";
import { Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { DefaultModelField } from "./engine-model-field.tsx";

/** A Copilot CLI engine's Settings: its name and default model, one it offers. */
export function CopilotCliEngineFields({
  edit,
  saved,
  change,
}: {
  readonly edit: CopilotCliEngineEdit;
  /** The engines as saved, whose lists give the models it offers. */
  readonly saved: EngineSettings;
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
        <DefaultModelField edit={edit} saved={saved} change={change} />
      </div>
    </div>
  );
}
