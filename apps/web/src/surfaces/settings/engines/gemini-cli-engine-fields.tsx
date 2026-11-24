import type { GeminiCliEngineEdit, EngineSettings } from "@the-office/contracts";
import { Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { DefaultModelField } from "./engine-model-field.tsx";

/** A Gemini CLI engine's Settings: its name and default model, one it offers. */
export function GeminiCliEngineFields({
  edit,
  saved,
  change,
}: {
  readonly edit: GeminiCliEngineEdit;
  /** The engines as saved, whose lists give the models it offers. */
  readonly saved: EngineSettings;
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
        <DefaultModelField edit={edit} saved={saved} change={change} />
      </div>
    </div>
  );
}
