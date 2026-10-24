import * as React from 'react';
export interface BadgeProps{
  /** Status colour. neutral for inactive/draft, success active, warning pending, danger failed/blocked, info informational, accent = brand/new */
  tone?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info';
  /** Leading status dot — use in tables for record status */
  dot?: boolean;
  /** Geist Mono — for IDs, versions, codes */
  mono?: boolean;
  size?: 'sm'|'md';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;
