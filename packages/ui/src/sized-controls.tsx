// The design system's controls and tables at the chosen density. They set their heights inline, in
// fixed pixels, and design-system/ stays as exported: so each size is restated here on the
// density's --control-h, `sm` being the alias itself and the larger sizes a fixed step above it,
// which keeps Comfortable's 28, 32 and 40 px. Spacing inside a control stays the design system's.
import type { JSX } from "react";
import {
  Button as DesignSystemButton,
  type ButtonProps,
} from "../../../design-system/components/core/Button.jsx";
import {
  IconButton as DesignSystemIconButton,
  type IconButtonProps,
} from "../../../design-system/components/core/IconButton.jsx";
import {
  DataTable as DesignSystemDataTable,
  type DataTableProps,
} from "../../../design-system/components/data/DataTable.jsx";
import {
  Input as DesignSystemInput,
  type InputProps,
} from "../../../design-system/components/forms/Input.jsx";
import {
  SegmentedControl as DesignSystemSegmentedControl,
  type SegmentedControlProps,
} from "../../../design-system/components/forms/SegmentedControl.jsx";
import {
  Select as DesignSystemSelect,
  type SelectProps,
} from "../../../design-system/components/forms/Select.jsx";
import type { Density } from "./appearance/apply-appearance.ts";
import { useAppearance } from "./appearance/use-appearance.ts";

type ControlSize = "xs" | "sm" | "md" | "lg";

/** Each size's step from --control-h, as the design system draws them in Comfortable. */
const CONTROL_STEP_PX: Readonly<Record<ControlSize, number>> = { xs: -4, sm: 0, md: 4, lg: 12 };

/** A control's height at the chosen density. */
export function controlHeight(size: ControlSize): string {
  const step = CONTROL_STEP_PX[size];
  if (step === 0) return "var(--control-h)";
  return `calc(var(--control-h) ${step > 0 ? "+" : "-"} ${Math.abs(step)}px)`;
}

export function Button({ size = "md", style, ...props }: ButtonProps): JSX.Element {
  return (
    <DesignSystemButton size={size} style={{ height: controlHeight(size), ...style }} {...props} />
  );
}

export function IconButton({ size = "md", style, ...props }: IconButtonProps): JSX.Element {
  const side = controlHeight(size);
  return (
    <DesignSystemIconButton
      size={size}
      style={{ width: side, height: side, ...style }}
      {...props}
    />
  );
}

export function Input({ size = "md", style, ...props }: InputProps): JSX.Element {
  return (
    <DesignSystemInput size={size} style={{ height: controlHeight(size), ...style }} {...props} />
  );
}

/**
 * The design system's Select sets its `<select>`'s height inline with no way in, so a data
 * attribute marks its size for sized-controls.css to restate.
 */
export function Select({ size = "md", ...props }: SelectProps): JSX.Element {
  const sized = { "data-control-size": size } as Partial<SelectProps>;
  return <DesignSystemSelect size={size} {...sized} {...props} />;
}

export function SegmentedControl({
  size = "md",
  style,
  ...props
}: SegmentedControlProps): JSX.Element {
  return (
    <DesignSystemSegmentedControl
      size={size}
      style={{ height: controlHeight(size), ...style }}
      {...props}
    />
  );
}

type TableDensity = NonNullable<DataTableProps["density"]>;

const TABLE_DENSITIES: readonly TableDensity[] = ["compact", "default", "relaxed"];

/** How many steps of the table's densities each density moves from the one a table asks for. */
const TABLE_DENSITY_STEP: Readonly<Record<Density, number>> = {
  compact: -1,
  comfortable: 0,
  relaxed: 1,
};

/**
 * A table's density at the chosen density: the one it asks for in Comfortable, a step tighter in
 * Compact and a step looser in Relaxed, within the design system's three.
 */
export function tableDensity(asked: TableDensity, density: Density): TableDensity {
  const index = TABLE_DENSITIES.indexOf(asked) + TABLE_DENSITY_STEP[density];
  return TABLE_DENSITIES[Math.min(Math.max(index, 0), TABLE_DENSITIES.length - 1)] ?? asked;
}

export function DataTable<T>({ density = "default", ...props }: DataTableProps<T>): JSX.Element {
  const appearance = useAppearance();
  return <DesignSystemDataTable density={tableDensity(density, appearance.density)} {...props} />;
}
