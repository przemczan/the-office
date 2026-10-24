import * as React from 'react';
export interface SelectOption{value: string;label: string;}
export interface SelectProps{
  label?: string;hint?: string;error?: string;required?: boolean;
  /** strings or {value,label} */
  options?: (string|SelectOption)[];
  value?: string;defaultValue?: string;
  onChange?: (value: string, e: React.ChangeEvent<HTMLSelectElement>) => void;
  placeholder?: string;
  size?: 'sm'|'md'|'lg';
  disabled?: boolean;id?: string;style?: React.CSSProperties;
}
export declare function Select(props: SelectProps): JSX.Element;
