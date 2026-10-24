import * as React from 'react';
export interface SwitchProps{
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** With label the switch sits right-aligned — settings row pattern */
  label?: React.ReactNode;
  description?: React.ReactNode;
  size?: 'sm'|'md';
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function Switch(props: SwitchProps): JSX.Element;
