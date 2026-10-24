import * as React from 'react';
export interface CardProps{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Header-right controls (IconButton, SegmentedControl, Menu) */
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** outline (default, no shadow), raised (shadow-2), sunken (inset panels) */
  variant?: 'outline'|'raised'|'sunken';
  /** none = edge-to-edge body (tables) with a divided header */
  padding?: 'none'|'sm'|'md'|'lg';
  children?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}
export declare function Card(props: CardProps): JSX.Element;
