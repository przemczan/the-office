import * as React from 'react';
export interface SegmentedOption{value: string;label: React.ReactNode;icon?: React.ReactNode;}
export interface SegmentedControlProps{
  /** 2–5 short options */
  options?: (string|SegmentedOption)[];
  value?: string;
  onChange?: (value: string) => void;
  size?: 'sm'|'md';
  style?: React.CSSProperties;
}
export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
