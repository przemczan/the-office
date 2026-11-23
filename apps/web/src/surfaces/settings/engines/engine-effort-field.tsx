import {
  ENGINE_TYPE_EFFORTS,
  effortSchema,
  type Effort,
  type EngineKind,
} from "@the-office/contracts";
import { Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { EFFORT_LABELS, ENGINE_KIND_LABELS } from "../../../shell/engine-words.ts";

/** The Default effort field's choice of none: Not set, which leaves it to the engine type. */
const NOT_SET = "";

/** What Default effort is for, under the field. */
export const DEFAULT_EFFORT_HINT =
  "How hard the model thinks for anyone who leaves their effort to the engine.";

/**
 * An engine's Default effort: Not set, or one of the efforts its type takes, in their order.
 * Nothing for a type that takes none.
 */
export function EngineEffortField({
  kind,
  value,
  onChange,
}: {
  readonly kind: EngineKind;
  /** Left out while a saved engine's edit keeps the stored one, which the draft always holds. */
  readonly value: Effort | null | undefined;
  readonly onChange: (defaultEffort: Effort | null) => void;
}): ReactNode {
  const efforts = ENGINE_TYPE_EFFORTS[kind];
  if (efforts.length === 0) return null;
  const notSet = value === null || value === undefined;
  return (
    <Select
      label="Default effort"
      hint={
        notSet ? `${DEFAULT_EFFORT_HINT} Left to ${ENGINE_KIND_LABELS[kind]}.` : DEFAULT_EFFORT_HINT
      }
      options={[
        { value: NOT_SET, label: "Not set" },
        ...efforts.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] })),
      ]}
      value={value ?? NOT_SET}
      onChange={(picked) => {
        const effort = effortSchema.safeParse(picked);
        onChange(effort.success ? effort.data : null);
      }}
    />
  );
}
