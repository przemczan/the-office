import { DurationHistogram } from "./duration-histogram.js";

const MINUTE_MS = 60_000;
const MINUTES_IN_AN_HOUR = 60;

/** A row's figures over the last hour. */
export interface LastHourFigures {
  readonly count: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly totalMs: number;
}

interface Row<Label> {
  readonly label: Label;
  /** By minute number (ms since the epoch / 60 000), only the minutes of the last hour. */
  readonly minutes: Map<number, DurationHistogram>;
  /** The durations in `minutes`, kept as they change, to find the least seen row at once. */
  seen: number;
}

/**
 * Durations by key (a route, a statement shape) over the last hour, in one-minute slots, so an
 * hour is honest to the minute; at most `keptRows` keys, the least seen dropped for a new one.
 */
export class LastHourTable<Label> {
  private readonly rows = new Map<string, Row<Label>>();

  constructor(private readonly keptRows: number) {}

  get size(): number {
    return this.rows.size;
  }

  /** Records a duration under `key`, `label` naming a new row; answers the row's label as kept. */
  record(key: string, label: Label, durationMs: number, atMs: number): Label {
    let row = this.rows.get(key);
    if (row === undefined) {
      if (this.rows.size >= this.keptRows) this.dropLeastSeen();
      row = { label, minutes: new Map(), seen: 0 };
      this.rows.set(key, row);
    }
    const minute = Math.floor(atMs / MINUTE_MS);
    let histogram = row.minutes.get(minute);
    if (histogram === undefined) {
      histogram = new DurationHistogram();
      row.minutes.set(minute, histogram);
    }
    histogram.add(durationMs);
    row.seen += 1;
    return row.label;
  }

  /** Drops the minutes older than the hour up to `nowMs`, and the rows left with none. */
  forgetBefore(nowMs: number): void {
    const oldestKept = Math.floor(nowMs / MINUTE_MS) - (MINUTES_IN_AN_HOUR - 1);
    for (const [key, row] of this.rows) {
      for (const [minute, histogram] of row.minutes) {
        if (minute >= oldestKept) continue;
        row.minutes.delete(minute);
        row.seen -= histogram.count;
      }
      if (row.minutes.size === 0) this.rows.delete(key);
    }
  }

  /** Every row of the hour up to `nowMs` with its figures, most total time first. */
  lastHour(nowMs: number): Array<{ readonly label: Label } & LastHourFigures> {
    this.forgetBefore(nowMs);
    const figures = [...this.rows.values()].map(({ label, minutes }) => {
      const hour = new DurationHistogram();
      for (const histogram of minutes.values()) hour.merge(histogram);
      return {
        label,
        count: hour.count,
        p95Ms: hour.percentile(95) ?? 0,
        maxMs: hour.max,
        totalMs: hour.sumMs,
      };
    });
    return figures.toSorted((a, b) => b.totalMs - a.totalMs);
  }

  private dropLeastSeen(): void {
    let leastKey: string | undefined;
    let least = Number.POSITIVE_INFINITY;
    for (const [key, row] of this.rows) {
      if (row.seen < least) {
        least = row.seen;
        leastKey = key;
      }
    }
    if (leastKey !== undefined) this.rows.delete(leastKey);
  }
}
