import type {
  CostliestSpend,
  FullStatsSplit,
  UsageSeries,
  WindowSeries,
} from "../domain/full-stats.js";
import type { HealthBlock, HealthSeries } from "../domain/system-health.js";

/** Where a Grafana is read: its address and, for one that asks, a read token sent as Bearer. */
export interface GrafanaAccess {
  readonly address: string;
  readonly token?: string;
}

/** A time range read in fixed steps. */
export interface SteppedRange {
  readonly from: Date;
  readonly to: Date;
  readonly stepSeconds: number;
}

/**
 * Narrows to the Projects of these names (the `office.project` attribute); undefined is every
 * Project. Never empty.
 */
export type ProjectNamesFilter = readonly string[] | undefined;

export interface UsageQuery extends SteppedRange {
  readonly split: FullStatsSplit;
  readonly projectNames: ProjectNamesFilter;
}

export interface CostliestQuery {
  readonly from: Date;
  readonly to: Date;
  /** How many Tasks and how many Initiatives at most. */
  readonly limit: number;
  readonly projectNames: ProjectNamesFilter;
}

/**
 * What a read answers: `read` with its value, `unreachable` when Grafana can't be reached or its
 * data source fails (no connection, no answer in time, an answer that isn't Grafana's), or
 * `rejected` when it refuses the read token (401 or 403).
 */
export type StatsSourceAnswer<T> =
  | { readonly kind: "read"; readonly value: T }
  | { readonly kind: "unreachable"; readonly problem: string }
  | { readonly kind: "rejected" };

/** System health over a range as Grafana answered it: each block's own answer, as each can fail. */
export type HealthSeriesRead = {
  readonly [Block in HealthBlock]: StatsSourceAnswer<HealthSeries[Block]>;
};

/** The names of the data sources the full stats would read in a Grafana; undefined for one it lacks. */
export interface DataSourcesFound {
  readonly prometheus?: string | undefined;
  readonly loki?: string | undefined;
}

/** Where the full stats' data is read from: Grafana's metrics and logs; an adapter binds it. */
export abstract class StatsSource {
  /** Tokens (cache reads left out) and estimated cost over time, by the split's values. */
  abstract usage(access: GrafanaAccess, query: UsageQuery): Promise<StatsSourceAnswer<UsageSeries>>;

  /** The most expensive Tasks and Initiatives, totalled from the `office.engine.call` records. */
  abstract costliest(
    access: GrafanaAccess,
    query: CostliestQuery,
  ): Promise<StatsSourceAnswer<CostliestSpend>>;

  /**
   * Which data sources the Grafana has, asked afresh: unreachable too for an address that answers,
   * but not as Grafana does.
   */
  abstract dataSources(access: GrafanaAccess): Promise<StatsSourceAnswer<DataSourcesFound>>;

  /** How full each engine's Usage windows were, Office-wide. */
  abstract windows(
    access: GrafanaAccess,
    range: SteppedRange,
  ): Promise<StatsSourceAnswer<readonly WindowSeries[]>>;

  /**
   * System health's measurements over a stepped range, Office-wide: each step's highest event loop
   * lag and connections waiting, its p95 times and the mean of the rest, with the range's totals
   * and slowest routes and queries, each block read on its own.
   */
  abstract systemHealth(access: GrafanaAccess, range: SteppedRange): Promise<HealthSeriesRead>;
}
