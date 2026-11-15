/**
 * Where a list read newest first goes on: after the row with this sort key, by its time and then
 * its id, so rows of the same time keep one order and none is read twice or skipped.
 */
export interface PageCursor {
  readonly at: Date;
  readonly id: string;
}

/** Which page of a list to read: after `after`, or the first page; `size` rows at most. */
export interface PageRequest {
  readonly after: PageCursor | undefined;
  readonly size: number;
}

/** A page of a list: its rows, the cursor of the next page (none on the last) and the whole count. */
export interface Page<Row> {
  readonly rows: readonly Row[];
  readonly next: PageCursor | undefined;
  readonly total: number;
}

/**
 * The page out of rows read one past its size, which tells whether another page follows: `keyOf`
 * gives the sort key of its last row, the next page's cursor.
 */
export function pageOf<Row>(
  readRows: readonly Row[],
  { size }: PageRequest,
  total: number,
  keyOf: (row: Row) => PageCursor,
): Page<Row> {
  const rows = readRows.slice(0, size);
  const last = rows.at(-1);
  return { rows, next: readRows.length > size && last ? keyOf(last) : undefined, total };
}

/** The rows of `page` turned into others, the cursor and the count kept. */
export function mapPage<Row, Mapped>(
  page: Page<Row>,
  map: (rows: readonly Row[]) => readonly Mapped[],
): Page<Mapped> {
  return { rows: map(page.rows), next: page.next, total: page.total };
}
