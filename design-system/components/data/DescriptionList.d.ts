import * as React from 'react';
export interface DescriptionItem{label: React.ReactNode;value?: React.ReactNode;mono?: boolean;/** true copies value; string copies that string */copyable?: boolean|string;}
export interface DescriptionListProps{
  items?: DescriptionItem[];
  /** inline = label column + value with dividers (detail pages); stacked = label above value */
  layout?: 'inline'|'stacked';
  columns?: number;
  labelWidth?: number;
  style?: React.CSSProperties;
}
export declare function DescriptionList(props: DescriptionListProps): JSX.Element;
