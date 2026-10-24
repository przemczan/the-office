import * as React from 'react';
/**
 * Action control. One primary (ink) per view; accent (ember) only for brand/hero moments like sign-in.
 * @startingPoint section="Core" subtitle="Buttons, badges, tags, avatars, cards" viewport="700x440"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>{
  /** primary = ink fill, accent = ember fill, secondary = bordered surface, ghost, danger, danger-ghost */
  variant?: 'primary'|'accent'|'secondary'|'ghost'|'danger'|'danger-ghost';
  /** sm 28px, md 32px (default), lg 40px */
  size?: 'sm'|'md'|'lg';
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
