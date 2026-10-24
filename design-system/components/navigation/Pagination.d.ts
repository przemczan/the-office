export interface PaginationProps{
  /** 1-based */
  page?: number;
  pageCount?: number;
  /** total records — enables the "1–25 of 1,284" summary */
  total?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  style?: React.CSSProperties;
}
export declare function Pagination(props: PaginationProps): JSX.Element;
