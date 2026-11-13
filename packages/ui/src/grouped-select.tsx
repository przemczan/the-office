// A Select whose options come in named groups, each option with a second line and badges, and an
// option that can't be chosen saying why (docs/spec/4.1-ui-rules.md: every disabled control says
// why). A native `<select>` can't: its `optgroup` has no second line, and a disabled `option` says
// why only on hover. So this is the select-only combobox pattern, a button over a list that opens
// under it, drawn on the design system's tokens.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Field } from "../../../design-system/components/forms/Input.jsx";
import { useEscapeWaitsFor } from "./overlays.tsx";

export interface GroupedSelectOption {
  readonly value: string;
  /** The option's name: its first line, its accessible name, and the field's text once chosen. */
  readonly label: string;
  /** The second line, such as what it holds. */
  readonly line?: ReactNode;
  /** What marks it at the first line's end, such as a badge. */
  readonly aside?: ReactNode;
  /** Why it can't be chosen; set, the option is disabled and this shows in place of its line. */
  readonly disabledWhy?: string;
}

export interface GroupedSelectGroup {
  readonly label: string;
  readonly options: readonly GroupedSelectOption[];
}

export interface GroupedSelectProps {
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  /** The chosen option's value; "" for none. */
  readonly value: string;
  readonly groups: readonly GroupedSelectGroup[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  /** Names the field for assistive technology alone, as a placeholder that says it all does. */
  readonly labelHidden?: boolean;
  readonly size?: "sm" | "md";
}

export function GroupedSelect({
  label,
  hint,
  placeholder,
  value,
  groups,
  onChange,
  disabled = false,
  labelHidden = false,
  size = "md",
}: GroupedSelectProps): ReactNode {
  const id = useId();
  const options = groups.flatMap((group) => group.options);
  const chosen = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | undefined>(undefined);
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEscapeWaitsFor(open);
  useClosedOnPressOutside(open, field, setOpen);
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  const optionId = (optionValue: string): string => `${id}-option-${optionValue}`;

  const openList = (): void => {
    const firstChoosable = options.find((option) => option.disabledWhy === undefined);
    setActive((chosen ?? firstChoosable ?? options[0])?.value);
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (option: GroupedSelectOption): void => {
    if (option.disabledWhy !== undefined) return;
    onChange(option.value);
    close();
  };
  // A disabled option is reached too, so its reason is read out; choosing it does nothing.
  const moveActive = (step: number | "first" | "last"): void => {
    if (options.length === 0) return;
    const at = options.findIndex((option) => option.value === active);
    const index =
      step === "first"
        ? 0
        : step === "last"
          ? options.length - 1
          : Math.min(Math.max(at + step, 0), options.length - 1);
    const next = options[index];
    setActive(next?.value);
    if (next) document.getElementById(optionId(next.value))?.scrollIntoView?.({ block: "nearest" });
  };

  const onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  };
  const onListKeyDown = (event: KeyboardEvent): void => {
    const moves: Readonly<Record<string, number | "first" | "last">> = {
      ArrowDown: 1,
      ArrowUp: -1,
      Home: "first",
      End: "last",
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      moveActive(move);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options.find(({ value: optionValue }) => optionValue === active);
      if (option) choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const select = (
    <div className="grouped-select" ref={field}>
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        role="combobox"
        className="grouped-select-trigger"
        data-control-size={size}
        aria-label={labelHidden ? label : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={chosen ? "grouped-select-value" : "grouped-select-value placeholder"}>
          {chosen?.label ?? placeholder ?? ""}
        </span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          className="grouped-select-list"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={active === undefined ? undefined : optionId(active)}
          onKeyDown={onListKeyDown}
        >
          {groups
            .filter((group) => group.options.length > 0)
            .map((group, index) => (
              <div key={group.label} role="group" aria-labelledby={`${id}-group-${index}`}>
                <div id={`${id}-group-${index}`} className="grouped-select-group">
                  {group.label}
                </div>
                {group.options.map((option) => (
                  <GroupedSelectRow
                    key={option.value}
                    id={optionId(option.value)}
                    option={option}
                    selected={option.value === value}
                    active={option.value === active}
                    onChoose={() => choose(option)}
                    onHover={() => setActive(option.value)}
                  />
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
  if (labelHidden) return select;
  return (
    <Field label={label} hint={hint} htmlFor={`${id}-trigger`}>
      {select}
    </Field>
  );
}

function GroupedSelectRow({
  id,
  option,
  selected,
  active,
  onChoose,
  onHover,
}: {
  readonly id: string;
  readonly option: GroupedSelectOption;
  readonly selected: boolean;
  readonly active: boolean;
  readonly onChoose: () => void;
  readonly onHover: () => void;
}): ReactNode {
  const why = option.disabledWhy;
  const line = why ?? option.line;
  return (
    <div
      id={id}
      role="option"
      className={active ? "grouped-select-option active" : "grouped-select-option"}
      aria-selected={selected}
      aria-disabled={why === undefined ? undefined : true}
      aria-labelledby={`${id}-label`}
      aria-describedby={line === undefined ? undefined : `${id}-line`}
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
      {line !== undefined && (
        <span
          id={`${id}-line`}
          className={why === undefined ? "grouped-select-line" : "grouped-select-line why"}
        >
          {line}
        </span>
      )}
    </div>
  );
}

/** A press anywhere outside the field closes its list, as a native select's does. */
function useClosedOnPressOutside(
  open: boolean,
  field: RefObject<HTMLElement | null>,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!field.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, field, setOpen]);
}
