import * as React from 'react';
export interface TagProps{
  /** Toggled filter state (ink fill) */
  selected?: boolean;
  onClick?: () => void;
  /** Shows × — use for applied filters */
  onRemove?: () => void;
  icon?: React.ReactNode;
  /** Optional trailing count, e.g. results per filter */
  count?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Tag(props: TagProps): JSX.Element;
