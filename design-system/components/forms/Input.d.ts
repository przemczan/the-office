import * as React from 'react';
/**
 * Text input with optional label, hint and error. Also exports Field (label/hint wrapper for any control).
 * @startingPoint section="Forms" subtitle="Inputs, selects, checkboxes, switches, segmented control" viewport="700x460"
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>,'size'>{
  label?: string;
  hint?: string;
  /** Error message — turns border red and replaces hint */
  error?: string;
  required?: boolean;
  /** sm 28, md 32 (default), lg 40 */
  size?: 'sm'|'md'|'lg';
  iconLeft?: React.ReactNode;
  /** Trailing node — unit, Kbd hint, clear button */
  suffix?: React.ReactNode;
  disabled?: boolean;
  inputStyle?: React.CSSProperties;
}
export declare function Input(props: InputProps): JSX.Element;
export interface FieldProps{label?: string;hint?: string;error?: string;required?: boolean;htmlFor?: string;children?: React.ReactNode;style?: React.CSSProperties;}
export declare function Field(props: FieldProps): JSX.Element;
