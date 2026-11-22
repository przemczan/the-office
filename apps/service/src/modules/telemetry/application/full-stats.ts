import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { StatsProjectFilter } from "../domain/basic-stats.js";
import {
  COSTLIEST,
  costliestOf,
  fullStatsSpanOf,
  holdsNoData,
  runningOf,
  stepEndOf,
  stepStartOf,
  stepsOf,
  usageBucketsOf,
  windowsOverTimeOf,
  type CostliestSpend,
  type CostliestInitiative,
  type CostliestTask,
  type FullStatsRange,
  type FullStatsSplit,
  type RunningStageRun,
  type UsageBucket,
  type UsageSeries,
  type WindowsOverTime,
} from "../domain/full-stats.js";
import { EngineWindows } from "../ports/engine-windows.js";
import { GrafanaInUse } from "../ports/grafana-in-use.js";
import { OfficeInitiatives } from "../ports/office-initiatives.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { ProjectNames } from "../ports/project-names.js";
import { RunningStageRuns } from "../ports/running-stage-runs.js";
import { StageRunEngines } from "../ports/stage-run-engines.js";
import { StatsSource, type GrafanaAccess, type ProjectNamesFilter } from "../ports/stats-source.js";
import {
  answered,
  failedRead,
  isRead,
  readFromGrafana,
  type GrafanaUnread,
} from "./grafana-reads.js";

export interface FullStatsQuery {
  readonly range: FullStatsRange;
  readonly split: FullStatsSplit;
}

/** The full stats as read from Grafana for the range asked. */
export interface FullStatsFigures {
  readonly state: "full";
  readonly address: string;
  readonly range: FullStatsRange;
  readonly split: FullStatsSplit;
  readonly from: Date;
  readonly to: Date;
  readonly usage: readonly UsageBucket[];
  readonly costliestTasks: readonly CostliestTask[];
  readonly costliestInitiatives: readonly CostliestInitiative[];
  readonly windows: readonly WindowsOverTime[];
  readonly running: readonly RunningStageRun[];
}

/** The full stats (spec 2.11, States): which state they are in, and the figures once read. */
export type FullStatsRead = GrafanaUnread | FullStatsFigures;

const NO_USAGE: UsageSeries = { tokens: [], estimatedCostUsd: [] };
const NO_COSTLIEST: CostliestSpend = { tasks: [], initiatives: [] };

/** Reads the full stats from the Grafana in use afresh on each read, as the page asks every minute. */
@Injectable()
export class FullStats {
  constructor(
    private readonly schedule: Schedule,
    private readonly grafana: GrafanaInUse,
    private readonly source: StatsSource,
    private readonly engineWindows: EngineWindows,
    private readonly runningStageRuns: RunningStageRuns,
    private readonly stageRunEngines: StageRunEngines,
    private readonly tasks: OfficeTasks,
    private readonly initiatives: OfficeInitiatives,
    private readonly projectNames: ProjectNames,
  ) {}

  /**
   * Tokens and estimated cost over time and the most expensive lists follow `filter` through the
   * Projects' names now; the lane follows it through each Task's Project; the Usage windows are
   * Office-wide. The first read that fails, in the order usage, most expensive, Usage windows,
   * gives the state.
   */
  read(query: FullStatsQuery, filter: StatsProjectFilter): Promise<FullStatsRead> {
    return readFromGrafana(this.grafana, (access) => this.readFrom(access, query, filter));
  }

  private async readFrom(
    access: GrafanaAccess,
    { range, split }: FullStatsQuery,
    filter: StatsProjectFilter,
  ): Promise<FullStatsRead> {
    const { address } = access;
    const span = fullStatsSpanOf(range, this.schedule.now());
    const { from, to } = span;
    const projectNames = await this.projectNamesOf(filter);
    const shown = projectNames !== "none-known";
    const narrowedTo = shown ? projectNames : undefined;
    const [usage, costliest, windows, spans, engines] = await Promise.all([
      shown
        ? this.source.usage(access, {
            from: stepStartOf(from, span.usageStepMs),
            to: stepEndOf(to, span.usageStepMs),
            stepSeconds: span.usageStepMs / 1000,
            split,
            projectNames: narrowedTo,
          })
        : answered(NO_USAGE),
      shown
        ? this.source.costliest(access, { from, to, limit: COSTLIEST, projectNames: narrowedTo })
        : answered(NO_COSTLIEST),
      this.source.windows(access, {
        from: stepStartOf(from, span.windowsStepMs),
        to: stepEndOf(to, span.windowsStepMs),
        stepSeconds: span.windowsStepMs / 1000,
      }),
      this.runningStageRuns.between(from, to),
      this.engineWindows.list(),
    ]);
    if (!isRead(usage) || !isRead(costliest) || !isRead(windows)) {
      return failedRead(address, [usage, costliest, windows]);
    }
    const read = { usage: usage.value, costliest: costliest.value, windows: windows.value };
    if (holdsNoData(read)) return { state: "no-data", address };
    const [tasks, initiatives, stageRunEngines] = await this.recordsOf(read.costliest, spans);
    const costliestNow = costliestOf({
      spend: read.costliest,
      tasks,
      initiatives,
      stageRunEngines,
      engines: engines.map(({ engineId, name }) => ({ engineId, name })),
    });
    return {
      state: "full",
      address,
      range,
      split,
      from,
      to,
      usage: usageBucketsOf(read.usage, stepsOf(from, to, span.usageStepMs), span.usageStepMs),
      costliestTasks: costliestNow.tasks,
      costliestInitiatives: costliestNow.initiatives,
      windows: windowsOverTimeOf(
        read.windows,
        engines.map(({ engineId, name, windows: now }) => ({
          engineId,
          name,
          hasWindows: now.state !== "none",
        })),
      ),
      running: runningOf(spans, tasks, filter),
    };
  }

  /** The names of the filter's Projects, undefined for every Project; `none-known` for none. */
  private async projectNamesOf(
    filter: StatsProjectFilter,
  ): Promise<ProjectNamesFilter | "none-known"> {
    if (filter === "all") return undefined;
    const known = filter.length === 0 ? [] : await this.projectNames.namesOf(filter);
    return known.length === 0 ? "none-known" : known.map(({ name }) => name);
  }

  /** The titles of the Tasks and Initiatives shown, and what the costliest ones' Stage runs ran on. */
  private async recordsOf(
    costliest: CostliestSpend,
    spans: readonly { readonly taskId: string }[],
  ) {
    const costliestTaskIds = new Set([
      ...costliest.tasks.map(({ taskId }) => taskId),
      ...costliest.initiatives.flatMap(({ tasks }) => tasks.map(({ taskId }) => taskId)),
    ]);
    costliestTaskIds.delete("");
    const taskIds = new Set([...costliestTaskIds, ...spans.map(({ taskId }) => taskId)]);
    const initiativeIds = costliest.initiatives.map(({ initiativeId }) => initiativeId);
    return Promise.all([
      this.tasks.findAll([...taskIds]),
      initiativeIds.length === 0 ? [] : this.initiatives.titlesOf(initiativeIds),
      costliestTaskIds.size === 0 ? [] : this.stageRunEngines.of([...costliestTaskIds]),
    ]);
  }
}
