import type { CostliestSpend, UsageSeries, WindowSeries } from "../../domain/full-stats.js";
import {
  StatsSource,
  type CostliestQuery,
  type DataSourcesFound,
  type GrafanaAccess,
  type StatsSourceAnswer,
  type SteppedRange,
  type UsageQuery,
} from "../../ports/stats-source.js";

/** A failure every read answers: Grafana unreachable with its problem, or the token rejected. */
export type ScriptedStatsFailure =
  { readonly kind: "unreachable"; readonly problem: string } | { readonly kind: "rejected" };

/**
 * What a scripted Grafana holds; each part absent answers empty, and its data sources absent are
 * both there.
 */
export interface ScriptedStats {
  readonly dataSources?: DataSourcesFound;
  readonly usage?: UsageSeries;
  readonly costliest?: CostliestSpend;
  readonly windows?: readonly WindowSeries[];
  readonly failure?: ScriptedStatsFailure;
}

/** The data sources a scripted Grafana has unless told otherwise: otel-lgtm's. */
const SCRIPTED_DATA_SOURCES: DataSourcesFound = { prometheus: "Prometheus", loki: "Loki" };

/** A read the scripted Grafana took. */
export type ScriptedStatsCall =
  | { readonly kind: "data-sources"; readonly access: GrafanaAccess }
  | { readonly kind: "usage"; readonly access: GrafanaAccess; readonly query: UsageQuery }
  | { readonly kind: "costliest"; readonly access: GrafanaAccess; readonly query: CostliestQuery }
  | { readonly kind: "windows"; readonly access: GrafanaAccess; readonly query: SteppedRange };

/**
 * Grafana's data for tests and the end-to-end service: no Grafana, only what a test sets with
 * `set`, whatever the query asks; every read is recorded in `calls`.
 */
export class ScriptedStatsSource extends StatsSource {
  readonly calls: ScriptedStatsCall[] = [];
  private stats: ScriptedStats = {};

  /** Replaces everything held before. */
  set(stats: ScriptedStats): void {
    this.stats = stats;
  }

  dataSources(access: GrafanaAccess): Promise<StatsSourceAnswer<DataSourcesFound>> {
    this.calls.push({ kind: "data-sources", access });
    return this.answer(this.stats.dataSources ?? SCRIPTED_DATA_SOURCES);
  }

  usage(access: GrafanaAccess, query: UsageQuery): Promise<StatsSourceAnswer<UsageSeries>> {
    this.calls.push({ kind: "usage", access, query });
    return this.answer(this.stats.usage ?? { tokens: [], estimatedCostUsd: [] });
  }

  costliest(
    access: GrafanaAccess,
    query: CostliestQuery,
  ): Promise<StatsSourceAnswer<CostliestSpend>> {
    this.calls.push({ kind: "costliest", access, query });
    return this.answer(this.stats.costliest ?? { tasks: [], initiatives: [] });
  }

  windows(
    access: GrafanaAccess,
    range: SteppedRange,
  ): Promise<StatsSourceAnswer<readonly WindowSeries[]>> {
    this.calls.push({ kind: "windows", access, query: range });
    return this.answer(this.stats.windows ?? []);
  }

  private answer<T>(value: T): Promise<StatsSourceAnswer<T>> {
    return Promise.resolve(this.stats.failure ?? { kind: "read", value });
  }
}
