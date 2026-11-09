import type { ReactNode } from "react";
import { Icon } from "../../../design-system/components/core/Icon.jsx";
import { IconButton } from "../../../design-system/components/core/IconButton.jsx";

export interface StepperProps {
  /** What the number is, for the buttons' labels and the read-out. */
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** How the number reads, such as "30k". */
  readonly format?: (value: number) => string;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}

/**
 * A number changed a step at a time between its bounds (prototypes/app/settings.js): Settings ›
 * Office limits and the Project page. The design system has none, hence this here.
 */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  disabled = false,
  onChange,
}: StepperProps): ReactNode {
  return (
    <div className="stepper">
      <IconButton
        icon={<Icon name="minus" size={14} />}
        label={`Lower ${label}`}
        variant="secondary"
        disabled={disabled || value - step < min}
        onClick={() => onChange(value - step)}
      />
      <output aria-label={label} aria-live="polite">
        {format(value)}
      </output>
      <IconButton
        icon={<Icon name="plus" size={14} />}
        label={`Raise ${label}`}
        variant="secondary"
        disabled={disabled || value + step > max}
        onClick={() => onChange(value + step)}
      />
    </div>
  );
}
