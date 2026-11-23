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

/** The Office default a level may take instead of its own: its type, and its account's name. */
export interface OfficeDefaultChoice {
  /** Null while no engine is listed. */
  readonly engineType: EngineKind | null;
  readonly engineName: string | null;
}

/** The Engine type field's choice of the Office default. */
const OFFICE_DEFAULT_CHOICE = "";

type ValueProps =
  | {
      readonly officeDefault?: undefined;
      readonly value: EngineTypeAccount;
      readonly onChange: (value: EngineTypeAccount) => void;
    }
  | {
      /** Offers "Office's default (<type>)" first; null `value` is that choice. */
      readonly officeDefault: OfficeDefaultChoice;
      readonly value: EngineTypeAccount | null;
      readonly onChange: (value: EngineTypeAccount | null) => void;
    };

/** "Office's default (Claude Code)", or bare while no engine is listed. */
export function officeDefaultLabel(name: string | null): string {
  return name === null ? "Office's default" : `Office's default (${name})`;
}

/**
 * Engine type and Account side by side, as a named group: the type with its icon, then that type's
 * accounts only. Picking a type picks its first account; `hint` says under both what the pair is
 * for. Settings › Engines' Office default draws it, and a Project's Engine block, which offers the
 * Office's default first and keeps Account off, naming the Office's account, while it is picked.
 */
export function EngineTypeAccountFields({
  name,
  choices,
  hint,
  disabled = false,
  ...props
}: {
  /** The group's name, such as "Office default". */
  readonly name: string;
  readonly choices: readonly EngineTypeChoice[];
  readonly hint?: ReactNode;
  readonly disabled?: boolean;
} & ValueProps): ReactNode {
  const { value } = props;
  const accounts = choices.find(({ engineType }) => engineType === value?.engineType)?.accounts;
  const shownType = value?.engineType ?? props.officeDefault?.engineType ?? null;
  const typeOptions = choices.map(({ engineType }) => ({
    value: engineType,
    label: ENGINE_KIND_LABELS[engineType],
  }));
  const officeDefault = props.officeDefault;
  return (
    <div className="engine-type-account">
      <div className="engine-type-account-fields" role="group" aria-label={name}>
        <div className="engine-type-field">
          {shownType !== null && (
            <span className="engine-type-icon" aria-hidden="true">
              <Icon name={ENGINE_KIND_ICONS[shownType]} size={15} strokeWidth={1.6} />
            </span>
          )}
          <Select
            label="Engine type"
            options={
              officeDefault
                ? [
                    {
                      value: OFFICE_DEFAULT_CHOICE,
                      label: officeDefaultLabel(
                        officeDefault.engineType && ENGINE_KIND_LABELS[officeDefault.engineType],
                      ),
                    },
                    ...typeOptions,
                  ]
                : typeOptions
            }
            value={value?.engineType ?? OFFICE_DEFAULT_CHOICE}
            disabled={disabled}
            onChange={(picked) => {
              if (props.officeDefault && picked === OFFICE_DEFAULT_CHOICE) {
                props.onChange(null);
                return;
              }
              const choice = choices.find(({ engineType }) => engineType === picked);
              const first = choice?.accounts[0];
              if (choice && first) {
                props.onChange({ engineType: choice.engineType, engineId: first.id });
              }
            }}
          />
        </div>
        {value === null ? (
          <Select
            label="Account"
            options={[
              {
                value: OFFICE_DEFAULT_CHOICE,
                label: officeDefaultLabel(officeDefault?.engineName ?? null),
              },
            ]}
            value={OFFICE_DEFAULT_CHOICE}
            disabled
          />
        ) : (
          <Select
            label="Account"
            options={(accounts ?? []).map(({ id, name: accountName }) => ({
              value: id,
              label: accountName,
            }))}
            value={value.engineId}
            disabled={disabled}
            onChange={(engineId) => props.onChange({ ...value, engineId })}
          />
        )}
      </div>
      {hint !== undefined && <p className="engine-type-account-hint">{hint}</p>}
    </div>
  );
}
