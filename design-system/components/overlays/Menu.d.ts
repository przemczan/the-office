import * as React from 'react';
export interface MenuItem{label?: React.ReactNode;icon?: React.ReactNode;shortcut?: string;danger?: boolean;disabled?: boolean;onSelect?: () => void;/** render a separator */divider?: boolean;/** render a small group heading */heading?: string;}
export interface MenuProps{
  /** element that toggles the menu — usually an IconButton */
  trigger: React.ReactNode;
  items?: MenuItem[];
  align?: 'start'|'end';
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: React.CSSProperties;
}
export declare function Menu(props: MenuProps): JSX.Element;
