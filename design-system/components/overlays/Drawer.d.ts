import * as React from 'react';
export interface DrawerProps{
  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** sticky footer actions */
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  /** render in-flow without overlay */
  inline?: boolean;
  style?: React.CSSProperties;
}
export declare function Drawer(props: DrawerProps): JSX.Element|null;
