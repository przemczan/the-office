import * as React from 'react';
export interface TopbarProps{
  /** Breadcrumbs / sidebar toggle */
  left?: React.ReactNode;
  /** Global search */
  center?: React.ReactNode;
  /** Notifications, theme toggle, avatar */
  right?: React.ReactNode;
  sticky?: boolean;
  style?: React.CSSProperties;
}
export declare function Topbar(props: TopbarProps): JSX.Element;
