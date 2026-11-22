// The checkbox sibling of RadioList: a form in a window that picks every answer that applies, as
// native checkboxes, one boxed line each, drawn by radio-list.css so the two lists look alike.
import type { ReactNode } from "react";

export interface CheckboxListOption {
  readonly value: string;
  readonly label: ReactNode;
  /** What sits at the line's end, such as a "Recommended" badge. */
  readonly aside?: ReactNode;
}

export interface CheckboxListProps {
  /** The group's name for assistive technology. */
  readonly label: string;
  readonly options: readonly CheckboxListOption[];
  /** The checked options' values. */
  readonly values: readonly string[];
  /** The checked values after a change, in the options' order. */
  readonly onChange: (values: readonly string[]) => void;
  readonly disabled?: boolean;
}

export function CheckboxList({
  label,
  options,
  values,
  onChange,
  disabled = false,
}: CheckboxListProps): ReactNode {
  const toggle = (value: string): void => {
    const checked = values.includes(value);
    onChange(
      options
        .map((option) => option.value)
        .filter((each) => (each === value ? !checked : values.includes(each))),
    );
  };
  return (
    <div className="radio-list" role="group" aria-label={label}>
      {options.map((option) => {
        const checked = values.includes(option.value);
        return (
          <label key={option.value} className={`radio-list-item${checked ? " picked" : ""}`}>
            <input
              type="checkbox"
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(option.value)}
            />
            <span className="radio-list-label">{option.label}</span>
            {option.aside}
          </label>
        );
      })}
    </div>
  );
}
