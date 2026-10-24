export interface IconProps{
  /** Lucide icon name in kebab-case, e.g. "users", "chevron-down" */
  name: string;
  /** px. 14 in sm controls, 16 default, 18–20 for nav/empty states */
  size?: number;
  strokeWidth?: number;
  color?: string;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): JSX.Element;
