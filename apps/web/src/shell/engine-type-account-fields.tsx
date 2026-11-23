import type { EngineId, EngineKind } from "@the-office/contracts";
import { Icon, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { ENGINE_KIND_ICONS, ENGINE_KIND_LABELS } from "./engine-words.ts";
import "./engine-type-account-fields.css";

/** An engine type and one of its accounts, an engine of that type: a level of the engine cascade. */
export interface EngineTypeAccount {
  readonly engineType: EngineKind;
  readonly engineId: EngineId;
}

/** An account the Account field offers: an engine, by its name. */
export interface AccountChoice {
  readonly id: EngineId;
  readonly name: string;
}

/** An engine type the Engine type field offers, with its accounts in the list's order. */
export interface EngineTypeChoice {
  readonly engineType: EngineKind;
  readonly accounts: readonly AccountChoice[];
}

/**
 * Engine type and Account side by side, as a named group: the type with its icon, then that type's
 * accounts only. Picking a type picks its first account; `hint` says under both what the pair is
 * for. Settings › Engines' Office default draws it, and a Project's Engine block will.
 */
export function EngineTypeAccountFields({
  name,
  value,
  choices,
  hint,
  disabled = false,
  onChange,
}: {
  /** The group's name, such as "Office default". */
  readonly name: string;
  readonly value: EngineTypeAccount;
  readonly choices: readonly EngineTypeChoice[];
  readonly hint?: ReactNode;
  readonly disabled?: boolean;
  readonly onChange: (value: EngineTypeAccount) => void;
}): ReactNode {
  const accounts = choices.find(({ engineType }) => engineType === value.engineType)?.accounts;
  return (
    <div className="engine-type-account">
      <div className="engine-type-account-fields" role="group" aria-label={name}>
        <div className="engine-type-field">
          <span className="engine-type-icon" aria-hidden="true">
            <Icon name={ENGINE_KIND_ICONS[value.engineType]} size={15} strokeWidth={1.6} />
          </span>
          <Select
            label="Engine type"
            options={choices.map(({ engineType }) => ({
              value: engineType,
              label: ENGINE_KIND_LABELS[engineType],
            }))}
            value={value.engineType}
            disabled={disabled}
            onChange={(picked) => {
              const choice = choices.find(({ engineType }) => engineType === picked);
              const first = choice?.accounts[0];
              if (choice && first) onChange({ engineType: choice.engineType, engineId: first.id });
            }}
          />
        </div>
        <Select
          label="Account"
          options={(accounts ?? []).map(({ id, name: accountName }) => ({
            value: id,
            label: accountName,
          }))}
          value={value.engineId}
          disabled={disabled}
          onChange={(engineId) => onChange({ ...value, engineId })}
        />
      </div>
      {hint !== undefined && <p className="engine-type-account-hint">{hint}</p>}
    </div>
  );
}
