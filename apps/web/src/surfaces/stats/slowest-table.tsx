import { Button, Icon } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import {
  countWords,
  durationWords,
  msWords,
  SHOW_FIRST_10,
  showAllWords,
  slowestFootWords,
  SORT_LABELS,
  sortByWords,
  type SlowestSort,
} from "./system-health-words.ts";

/** How many rows a slowest table shows until Show all. */
const FIRST_ROWS = 10;

/** A row of a slowest table: what it is, and its figures over the range. */
export interface SlowestRow {
  readonly id: string;
  readonly what: ReactNode;
  /** Words rather than code, such as "Unmatched: no route answered". */
  readonly plain?: boolean;
  readonly count: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly totalMs: number;
  /** What the row unfolds to, under it; the row's `what` is clamped to 2 lines while folded. */
  readonly fold?: { readonly label: string; readonly content: ReactNode };
}

/** Columns besides `what`: the figures. */
const FIGURE_COLUMNS = 4;

const SORTS: readonly SlowestSort[] = ["count", "p95", "max", "total"];

function sortValue(row: SlowestRow, by: SlowestSort): number {
  switch (by) {
    case "count":
      return row.count;
    case "p95":
      return row.p95Ms;
    case "max":
      return row.maxMs;
    case "total":
      return row.totalMs;
  }
}

/**
 * The slowest routes or queries (spec 2.11, System health 8): by total time at first, what kept
 * The Office busiest; each figure column's head a sort button, largest first, `aria-sort` on the
 * column sorted by. The first 10 rows, then Show all; each row's total time with a bar against the
 * longest and its share of all the time; the foot says how many and their time in all. A row with
 * a fold shows its first 2 lines until its fold button unfolds it whole, with the fold under it.
 *
 * Drawn as its own table, as the design system's DataTable has no `aria-sort` and sorts both ways.
 */
export function SlowestTable({
  title,
  when,
  whatHead,
  countHead,
  rows,
  one,
  many,
  empty,
}: {
  readonly title: string;
  readonly when: string;
  readonly whatHead: string;
  readonly countHead: string;
  readonly rows: readonly SlowestRow[];
  /** What one row is, and many: "route", "routes". */
  readonly one: string;
  readonly many: string;
  readonly empty: string;
}): ReactNode {
  const [by, setBy] = useState<SlowestSort>("total");
  const [all, setAll] = useState(false);
  const sorted = rows.toSorted((first, second) => sortValue(second, by) - sortValue(first, by));
  const shown = all ? sorted : sorted.slice(0, FIRST_ROWS);
  const allTime = rows.reduce((sum, row) => sum + row.totalMs, 0);
  const longest = Math.max(1, ...rows.map(({ totalMs }) => totalMs));
  const columnName = (sort: SlowestSort): string =>
    sort === "count" ? countHead : SORT_LABELS[sort];
  return (
    <div className="stats-slowest">
      <div className="stats-slowest-head">
        <span className="stats-sub-title">
          {title}
          <span className="stats-block-when">{when}</span>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="stats-empty">{empty}</p>
      ) : (
        <>
          <div className="stats-slowest-scroll">
            <table className="stats-slowest-table">
              <thead>
                <tr>
                  <th scope="col" className="stats-slowest-what">
                    {whatHead}
                  </th>
                  {SORTS.map((sort) => (
                    <th key={sort} scope="col" aria-sort={by === sort ? "descending" : undefined}>
                      <button
                        type="button"
                        className="stats-sort"
                        aria-label={sortByWords(columnName(sort))}
                        onClick={() => setBy(sort)}
                      >
                        {columnName(sort)}
                        <Icon name="arrow-down" size={12} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <SlowestTableRow
                    key={row.id}
                    row={row}
                    top={by === "total" && index === 0}
                    longest={longest}
                    allTime={allTime}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="stats-slowest-foot">
            <span>{slowestFootWords(rows.length, one, many, durationWords(allTime))}</span>
            {rows.length > FIRST_ROWS && (
              <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
                {all ? SHOW_FIRST_10 : showAllWords(rows.length)}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A row with its figures and, for a row that unfolds, its fold button and the row it opens. */
function SlowestTableRow({
  row,
  top,
  longest,
  allTime,
}: {
  readonly row: SlowestRow;
  /** The first by total time, its bar marked. */
  readonly top: boolean;
  readonly longest: number;
  readonly allTime: number;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const foldId = useId();
  const { fold } = row;
  return (
    <>
      <tr className={top ? "stats-slowest-top" : undefined}>
        <th scope="row" className={`stats-slowest-what${row.plain ? " stats-slowest-plain" : ""}`}>
          {fold === undefined ? (
            row.what
          ) : (
            <span className="stats-slowest-folding">
              <button
                type="button"
                className="stats-fold"
                aria-expanded={open}
                aria-controls={open ? foldId : undefined}
                aria-label={fold.label}
                onClick={() => setOpen(!open)}
              >
                <Icon name="chevron-right" size={14} />
              </button>
              <span className={open ? undefined : "stats-slowest-clamp"}>{row.what}</span>
            </span>
          )}
        </th>
        <td>{countWords(row.count)}</td>
        <td>{msWords(row.p95Ms)}</td>
        <td>{msWords(row.maxMs)}</td>
        <td className="stats-slowest-total">
          <span className="stats-share">
            <span className="stats-share-track" aria-hidden="true">
              <i style={{ width: `${((row.totalMs / longest) * 100).toFixed(1)}%` }} />
            </span>
            {durationWords(row.totalMs)}{" "}
            <span className="stats-muted">
              {Math.round((row.totalMs / Math.max(1, allTime)) * 100)}%
            </span>
          </span>
        </td>
      </tr>
      {fold !== undefined && open && (
        <tr className="stats-slowest-fold">
          <td id={foldId} colSpan={1 + FIGURE_COLUMNS}>
            {fold.content}
          </td>
        </tr>
      )}
    </>
  );
}
