import * as React from 'react';
export interface ProgressBarProps{
  value?: number;
  max?: number;
  /** auto = green → amber (75%) → red (90%), for quotas and limits */
  tone?: 'accent'|'neutral'|'success'|'warning'|'danger'|'info'|'auto';
  label?: React.ReactNode;
  /** overrides the default "NN%" */
  valueLabel?: React.ReactNode;
  size?: 'sm'|'md';
  style?: React.CSSProperties;
}
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
