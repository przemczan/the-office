import * as React from 'react';
export interface CheckboxProps{
  checked?: boolean;
  /** Mixed state — "select all" when some rows are selected */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
