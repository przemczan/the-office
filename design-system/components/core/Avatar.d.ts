export interface AvatarProps{
  /** Full name — initials and colour are derived from it */
  name?: string;
  src?: string;
  /** The picture at `src` couldn't be loaded */
  onImageError?: () => void;
  /** xs 20, sm 24, md 32, lg 40, xl 56 */
  size?: 'xs'|'sm'|'md'|'lg'|'xl';
  style?: React.CSSProperties;
}
export declare function Avatar(props: AvatarProps): JSX.Element;
