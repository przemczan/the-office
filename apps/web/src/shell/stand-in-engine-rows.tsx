import type { EngineId, EngineKind } from "@the-office/contracts";
import { Icon, IconButton, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { ENGINE_KIND_ICONS, ENGINE_KIND_LABELS } from "./engine-words.ts";
import "./stand-in-engine-rows.css";

/**
 * A Stand-in Engine list's rows (spec 5.4.6), shared by Settings › Engines' Office-wide list and a
 * Project's own on its Engine block: each engine in its order with its type's icon, Move up, Move
 * down and Remove, and an optional note under it; read-only, greyed and without the tools.
 */

/** One listed engine, by its name, with its type when it is still saved. */
export interface StandInEngineRow {
  readonly id: EngineId;
  readonly name: string;
  readonly kind: EngineKind | null;
  /** A line under the row, such as why another engine type stands in differently. */
  readonly note?: string | null;
}

/** An engine "Add a stand-in" may offer. */
export interface StandInEngineChoice {
  readonly id: EngineId;
  readonly name: string;
}

/** The list with the engine at `index` moved by `by` places, kept within the list. */
export function withStandInMoved(
  standIns: readonly EngineId[],
  index: number,
  by: -1 | 1,
): readonly EngineId[] {
  const to = index + by;
  if (index < 0 || to < 0 || to >= standIns.length) return standIns;
  const moved = [...standIns];
  [moved[index], moved[to]] = [moved[to] as EngineId, moved[index] as EngineId];
  return moved;
}

export function StandInEngineRows({
  rows,
  empty,
  readOnly = false,
  disabled = false,
  onChange,
}: {
  readonly rows: readonly StandInEngineRow[];
  /** What shows while nothing is listed. */
  readonly empty: string;
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly onChange?: (standIns: readonly EngineId[]) => void;
}): ReactNode {
  if (rows.length === 0) return <p className="stand-in-engine-empty">{empty}</p>;
  const ids = rows.map(({ id }) => id);
  const change = (standIns: readonly EngineId[]): void => onChange?.(standIns);
  return (
    <ol
      className="stand-in-engine-rows"
      aria-label="Stand-in Engines"
      data-read-only={readOnly ? "" : undefined}
      aria-disabled={readOnly || undefined}
    >
      {rows.map(({ id, name, kind, note }, index) => (
        <li key={id} className="stand-in-engine-row">
          <span className="stand-in-engine-place">{index + 1}</span>
          {kind ? (
            <span
              className="stand-in-engine-kind"
              role="img"
              aria-label={ENGINE_KIND_LABELS[kind]}
              title={ENGINE_KIND_LABELS[kind]}
            >
              <Icon name={ENGINE_KIND_ICONS[kind]} size={14} strokeWidth={1.6} />
            </span>
          ) : (
            <span className="stand-in-engine-kind" />
          )}
          <span className="stand-in-engine-name">{name}</span>
          {!readOnly && (
            <span className="stand-in-engine-tools">
              <IconButton
                size="sm"
                icon={<Icon name="chevron-up" size={14} />}
                label={`Move ${name} up`}
                title={index === 0 ? `${name} is first already` : `Move ${name} up`}
                disabled={disabled || index === 0}
                onClick={() => change(withStandInMoved(ids, index, -1))}
              />
              <IconButton
                size="sm"
                icon={<Icon name="chevron-down" size={14} />}
                label={`Move ${name} down`}
                title={index === rows.length - 1 ? `${name} is last already` : `Move ${name} down`}
                disabled={disabled || index === rows.length - 1}
                onClick={() => change(withStandInMoved(ids, index, 1))}
              />
              <IconButton
                size="sm"
                icon={<Icon name="x" size={14} />}
                label={`Remove ${name} from the Stand-in Engines`}
                disabled={disabled}
                onClick={() => change(ids.filter((listedId) => listedId !== id))}
              />
            </span>
          )}
          {note && <p className="stand-in-engine-note">{note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** "Add a stand-in" over the engines not listed, adding the one picked last. */
export function AddStandIn({
  addable,
  hint,
  disabled = false,
  onAdd,
}: {
  readonly addable: readonly StandInEngineChoice[];
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onAdd: (id: EngineId) => void;
}): ReactNode {
  return (
    <Select
      label="Add a stand-in"
      placeholder={addable.length > 0 ? "Pick a saved engine" : "Every saved engine is listed"}
      hint={hint}
      disabled={disabled || addable.length === 0}
      options={addable.map(({ id, name }) => ({ value: id, label: name }))}
      value=""
      onChange={(id) => id !== "" && onAdd(id)}
    />
  );
}
