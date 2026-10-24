import * as React from 'react';
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>{
  icon: React.ReactNode;
  /** Required accessible label; also shown as native title */
  label: string;
  variant?: 'ghost'|'secondary'|'primary';
  /** xs 24, sm 28, md 32, lg 40 */
  size?: 'xs'|'sm'|'md'|'lg';
  disabled?: boolean;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
