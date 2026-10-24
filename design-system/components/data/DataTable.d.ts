import * as React from 'react';
export interface DataTableColumn<T=any>{
  key: string;
  header: React.ReactNode;
  /** custom cell renderer */
  render?: (row: T, index: number) => React.ReactNode;
  align?: 'left'|'right'|'center';
  width?: number|string;
  maxWidth?: number|string;
  sortable?: boolean;
  /** Geist Mono — IDs, codes, timestamps */
  mono?: boolean;
  /** secondary text colour */
  muted?: boolean;
  wrap?: boolean;
}
/**
 * Data table with sortable headers, row selection, row click, loading skeleton and empty state.
 * @startingPoint section="Data" subtitle="Table, stat cards, description list, audit timeline" viewport="700x460"
 */
export interface DataTableProps<T=any>{
  columns?: DataTableColumn<T>[];
  rows?: T[];
  /** property used as React key + selection id. Default "id" */
  rowKey?: string;
  selectable?: boolean;
  selected?: (string|number)[];
  onSelectionChange?: (keys: (string|number)[]) => void;
  onRowClick?: (row: T) => void;
  sort?: {key: string; dir: 'asc'|'desc'};
  onSortChange?: (sort: {key: string; dir: 'asc'|'desc'}) => void;
  /** row height: compact 36, default 44, relaxed 52 */
  density?: 'compact'|'default'|'relaxed';
  stickyHeader?: boolean;
  empty?: React.ReactNode;
  loading?: boolean;
  style?: React.CSSProperties;
}
export declare function DataTable(props: DataTableProps): JSX.Element;
