// A select you type in to find an option among many, as a native `<select>` can't: the editable
// combobox pattern (ARIA 1.2) with a list popup. The focus stays in the box while the list shows the
// best matches; the list opens under the box, over everything, as `GroupedSelect`'s does, in its
// styles, its options in named groups when they name one, each with a second line and badges.
import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Field } from "../../../design-system/components/forms/Input.jsx";
import { bestMatches } from "./best-matches.ts";
import { useEscapeWaitsFor } from "./overlays.tsx";
import { usePlaceUnder } from "./place-under.ts";

export interface SearchableSelectOption {
  readonly value: string;
  /** The option's name: what the text typed is matched against, and the box's text once chosen. */
  readonly label: string;
  /** Other words the text typed is matched against, such as what the option means. */
  readonly alsoMatches?: readonly string[];
  /**
   * The group it is listed under, by its name; the groups show in the order their first option
   * comes in `options`, each with its matches.
   */
  readonly group?: string;
  /** The second line, such as what it holds. */
  readonly line?: ReactNode;
  /** What marks it at the first line's end, such as a badge. */
  readonly aside?: ReactNode;
  /** A note shown on hover. */
  readonly title?: string;
}

export interface SearchableSelectProps {
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  /** The chosen option's value; "" for none. */
  readonly value: string;
  readonly options: readonly SearchableSelectOption[];
  readonly onChange: (value: string) => void;
  /**
   * The clear button's accessible name, such as "Clear the Initiative filter"; left out, there is
   * no clear button, as for a select always holding a choice.
   */
  readonly clearLabel?: string;
  /** What the list says when nothing matches the text, such as "No Initiative matches". */
  readonly noMatches: string;
  /** How many matches the list shows at most. */
  readonly limit?: number;
  /** Names the field for assistive technology alone, as a placeholder that says it all does. */
  readonly labelHidden?: boolean;
  readonly size?: "sm" | "md";
  /**
   * Lets the words typed be the value, as the list's last row "Use “<words>”" offers while they
   * aren't an option's name, at most `maxLength` characters: the value then needn't be an
   * option's, and the box shows it as written.
   */
  readonly ownValue?: { readonly maxLength?: number };
}

const DEFAULT_LIMIT = 10;

/** The "Use “<words>”" row's key among the options', which no option's value is. */
const OWN_VALUE_ROW = ":own-value:";

export function SearchableSelect({
  label,
  hint,
  placeholder,
  value,
  options,
  onChange,
  clearLabel,
  noMatches,
  limit = DEFAULT_LIMIT,
  labelHidden = false,
  size = "md",
  ownValue,
}: SearchableSelectProps): ReactNode {
  const id = useId();
  const chosen = options.find((option) => option.value === value);
  // A value of the user's own words, which no option holds.
  const ownChosen = ownValue !== undefined && value !== "" && chosen === undefined;
  // Undefined while the user isn't typing, so the box shows the choice.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | undefined>(undefined);
  const field = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const groupNames = [
    ...new Set(options.flatMap(({ group }) => (group === undefined ? [] : [group]))),
  ];
  const ownRowOf = (text: string): SearchableSelectOption | undefined => {
    const words = text.trim();
    if (ownValue === undefined || words === "") return undefined;
    if (options.some((option) => option.label === words)) return undefined;
    return { value: OWN_VALUE_ROW, label: `Use “${words}”` };
  };
  const rowsOf = (text: string): readonly SearchableSelectOption[] => {
    const ownRow = ownRowOf(text);
    const found = inGroups(bestMatches(options, text, limit), groupNames);
    return ownRow ? [...found, ownRow] : found;
  };
  const matches = rowsOf(typed ?? "");
  // One for the field's life, as the list's placing and listeners depend on it.
  const closeQuietly = useCallback(() => {
    setOpen(false);
    setTyped(undefined);
  }, []);
  useEscapeWaitsFor(open);

  const optionId = (optionValue: string): string => `${id}-option-${optionValue}`;

  const openList = (shown: readonly SearchableSelectOption[]): void => {
    const chosenShown = shown.find((option) => option.value === value);
    setActive((chosenShown ?? shown[0])?.value);
    setOpen(true);
  };
  const choose = (option: SearchableSelectOption): void => {
    onChange(option.value === OWN_VALUE_ROW ? (typed ?? "").trim() : option.value);
    closeQuietly();
  };
  const clear = (): void => {
    onChange("");
    closeQuietly();
    box.current?.focus();
  };
  const moveActive = (step: number): void => {
    if (matches.length === 0) return;
    const at = matches.findIndex((option) => option.value === active);
    const next = matches[Math.min(Math.max(at + step, 0), matches.length - 1)];
    setActive(next?.value);
    if (next) document.getElementById(optionId(next.value))?.scrollIntoView?.({ block: "nearest" });
  };

  const onType = (event: ChangeEvent<HTMLInputElement>): void => {
    const text = event.target.value;
    setTyped(text);
    setActive(rowsOf(text)[0]?.value);
    setOpen(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (open) moveActive(event.key === "ArrowDown" ? 1 : -1);
      else openList(matches);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = matches.find(({ value: optionValue }) => optionValue === active);
      if (option) choose(option);
    } else if (event.key === "Escape" && (open || typed !== undefined)) {
      event.preventDefault();
      closeQuietly();
    } else if (event.key === "Tab") {
      closeQuietly();
    }
  };

  const select = (
    <div className="searchable-select" ref={field}>
      <input
        ref={box}
        id={`${id}-box`}
        type="text"
        role="combobox"
        className="searchable-select-box"
        data-control-size={size}
        aria-label={labelHidden ? label : undefined}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active !== undefined ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={typed ?? chosen?.label ?? (ownChosen ? value : "")}
        maxLength={ownValue?.maxLength}
        onChange={onType}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (!open) openList(matches);
        }}
        // A press in the list keeps the focus here, so a blur is a press outside or Tab.
        onBlur={closeQuietly}
      />
      {clearLabel !== undefined && (chosen || ownChosen) && (
        <button
          type="button"
          className="searchable-select-clear"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={clear}
        >
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {open && (
        <SearchableSelectList
          id={`${id}-list`}
          list={list}
          field={field}
          label={label}
          onClose={closeQuietly}
        >
          {matches.length === 0 ? (
            <div
              className="searchable-select-none"
              role="option"
              aria-selected={false}
              aria-disabled
            >
              {noMatches}
            </div>
          ) : (
            groupsOf(matches).map(({ group, options: grouped }, index) => {
              const rows = grouped.map((option) => (
                <SearchableSelectRow
                  key={option.value}
                  id={optionId(option.value)}
                  option={option}
                  selected={option.value === value && option.value !== OWN_VALUE_ROW}
                  active={option.value === active}
                  onChoose={() => choose(option)}
                  onHover={() => setActive(option.value)}
                />
              ));
              if (group === undefined) return rows;
              return (
                <div key={group} role="group" aria-labelledby={`${id}-group-${index}`}>
                  <div id={`${id}-group-${index}`} className="grouped-select-group">
                    {group}
                  </div>
                  {rows}
                </div>
              );
            })
          )}
        </SearchableSelectList>
      )}
    </div>
  );
  if (labelHidden) return select;
  return (
    <Field label={label} hint={hint} htmlFor={`${id}-box`}>
      {select}
    </Field>
  );
}

/** The options in their groups' order, each group's in the order found. */
function inGroups(
  found: readonly SearchableSelectOption[],
  groupNames: readonly string[],
): SearchableSelectOption[] {
  if (groupNames.length === 0) return [...found];
  const at = (option: SearchableSelectOption): number =>
    option.group === undefined ? groupNames.length : groupNames.indexOf(option.group);
  return found.toSorted((first, second) => at(first) - at(second));
}

/** The rows as listed, each run of one group's together. */
function groupsOf(rows: readonly SearchableSelectOption[]): {
  readonly group: string | undefined;
  readonly options: readonly SearchableSelectOption[];
}[] {
  const runs: { group: string | undefined; options: SearchableSelectOption[] }[] = [];
  for (const row of rows) {
    const last = runs.at(-1);
    if (last !== undefined && last.group === row.group) last.options.push(row);
    else runs.push({ group: row.group, options: [row] });
  }
  return runs;
}

function SearchableSelectRow({
  id,
  option,
  selected,
  active,
  onChoose,
  onHover,
}: {
  readonly id: string;
  readonly option: SearchableSelectOption;
  readonly selected: boolean;
  readonly active: boolean;
  readonly onChoose: () => void;
  readonly onHover: () => void;
}): ReactNode {
  return (
    <div
      id={id}
      role="option"
      className={active ? "grouped-select-option active" : "grouped-select-option"}
      aria-selected={selected}
      aria-labelledby={`${id}-label`}
      aria-describedby={option.line === undefined ? undefined : `${id}-line`}
      title={option.title}
      onClick={onChoose}
      onMouseEnter={onHover}
    >
      <span className="grouped-select-tick" aria-hidden="true">
        {selected && (
          <svg width="13" height="13" viewBox="0 0 24 24">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span id={`${id}-label`} className="grouped-select-label">
        {option.label}
      </span>
      {option.aside !== undefined && <span className="grouped-select-aside">{option.aside}</span>}
      {option.line !== undefined && (
        <span id={`${id}-line`} className="grouped-select-line">
          {option.line}
        </span>
      )}
    </div>
  );
}

/** The open list, placed as `GroupedSelect`'s is: portalled, fixed and under the field. */
function SearchableSelectList({
  id,
  list,
  field,
  label,
  onClose,
  children,
}: {
  readonly id: string;
  readonly list: RefObject<HTMLDivElement | null>;
  readonly field: RefObject<HTMLDivElement | null>;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const place = usePlaceUnder(field, list, onClose);
  const holder = field.current?.closest('[aria-modal="true"]') ?? document.body;
  const fieldWidth = field.current?.getBoundingClientRect().width;
  return createPortal(
    <div
      ref={list}
      id={id}
      className="grouped-select-list"
      role="listbox"
      aria-label={label}
      style={{ minWidth: fieldWidth, ...(place ?? { visibility: "hidden" }) }}
      // The focus stays in the box, as the pattern asks.
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    holder,
  );
}
