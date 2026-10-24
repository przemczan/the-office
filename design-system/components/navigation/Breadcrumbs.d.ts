export interface BreadcrumbItem{label: string;href?: string;onClick?: () => void;}
export interface BreadcrumbsProps{items?: BreadcrumbItem[];style?: React.CSSProperties;}
export declare function Breadcrumbs(props: BreadcrumbsProps): JSX.Element;
