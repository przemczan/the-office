import type { EngineModel, RoleCardOptions } from "@the-office/contracts";
import { Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "./engine-words.ts";
import { missingCapabilitiesWords } from "./role-card-words.ts";
import { useEngineName } from "./use-engine-name.ts";

/** An engine Settings › Engines lists, with its models, as `/role-card-options` offers it. */
export type OfferedEngine = RoleCardOptions["engines"][number];

/** The Engine field's choice of nothing at this level. */
const NO_ENGINE = "";

/**
 * A level of the engine cascade: an Engine field, then its Model once an engine is picked. Picking
 * an engine fills in its default model. With `noneLabel` the Engine field also offers nothing at
 * this level; without it, `value` always names an engine. The caller lays the two fields out.
 */
export function EngineModelFields({
  value,
  engines,
  noneLabel,
  noneHint,
  disabled = false,
  onChange,
}: {
  readonly value: EngineModel | null;
  readonly engines: readonly OfferedEngine[];
  readonly noneLabel?: string;
  /** What the Engine field's hint says while nothing is set at this level, such as what applies. */
  readonly noneHint?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: EngineModel | null) => void;
}): ReactNode {
  const engineName = useEngineName();
  const picked = engines.find(({ engine }) => engine === value?.engineId);
  return (
    <>
      <Select
        label="Engine"
        hint={
          picked
            ? missingCapabilitiesWords(picked.missingCapabilities)
            : value
              ? undefined
              : noneHint
        }
        value={value?.engineId ?? NO_ENGINE}
        options={[
          ...(noneLabel === undefined ? [] : [{ value: NO_ENGINE, label: noneLabel }]),
          ...engines.map(({ engine }) => ({ value: engine, label: engineName(engine) })),
        ]}
        disabled={disabled}
        onChange={(engineId) => {
          const engine = engines.find((offered) => offered.engine === engineId);
          onChange(engine ? { engineId: engine.engine, model: engine.defaultModel } : null);
        }}
      />
      {value && (
        <Select
          label="Model"
          value={value.model}
          options={(picked?.models ?? []).map((model) => ({
            value: model,
            label: modelLabel(model),
          }))}
          disabled={disabled}
          onChange={(model) => onChange({ ...value, model })}
        />
      )}
    </>
  );
}
