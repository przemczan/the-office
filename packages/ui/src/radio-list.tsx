// The design system's RadioGroup draws its radios as spans: they have no name and the keyboard
// can't reach them. A form in a window (docs/spec/4.1-ui-rules.md#windows, "Answering in a window
// is a form") picks one of a few answers, so this list is native radios, one boxed line each, drawn
// on the design system's tokens.
import type { ReactNode } from "react";

export interface RadioListOption {
  readonly value: string;
  readonly label: ReactNode;
  /** What sits at the line's end, such as a "Recommended" badge. */
  readonly aside?: ReactNode;
}

export interface RadioListProps {
  /** The group's name for assistive technology. */
  readonly label: string;
  /** The radios' shared `name`, unique on the page. */
  readonly name: string;
  readonly options: readonly RadioListOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

export function RadioList({
  label,
  name,
  options,
  value,
  onChange,
  disabled = false,
}: RadioListProps): ReactNode {
  return (
    <div className="radio-list" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const picked = option.value === value;
        return (
          <label key={option.value} className={`radio-list-item${picked ? " picked" : ""}`}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={picked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="radio-list-label">{option.label}</span>
            {option.aside}
          </label>
        );
      })}
    </div>
  );
}
