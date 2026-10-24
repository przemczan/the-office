export interface LogoProps{
  /** horizontal lockup (default) or the standalone ! mark */
  variant?: 'horizontal'|'mark';
  /** auto follows the theme (fg-1 + ember) */
  tone?: 'auto'|'light'|'dark'|'mono-ink'|'mono-white';
  /** lockup height in px */
  size?: number;
  /** Optional product label rendered as a mono chip, e.g. "Admin" */
  product?: string;
  style?: React.CSSProperties;
}
export declare function Logo(props: LogoProps): JSX.Element;
