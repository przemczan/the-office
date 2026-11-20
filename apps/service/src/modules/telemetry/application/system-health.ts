import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { stepEndOf, stepStartOf } from "../domain/full-stats.js";
import {
  grafanaFiguresOf,
  HEALTH_BLOCKS,
  HEALTH_READING_STEP_SECONDS,
  healthSpanOf,
  holdsNoHealthData,
  lastHourFiguresOf,
  type GrafanaHealthRange,
  type HealthBlock,
  type HealthFigures,
  type HealthSeries,
  type SystemHealthRange,
} from "../domain/system-health.js";
import { BrowserConnections } from "../ports/browser-connections.js";
import { GrafanaInUse } from "../ports/grafana-in-use.js";
import { HealthReadings } from "../ports/health-readings.js";
import { SessionsRunning } from "../ports/sessions-running.js";
import { StageRunsRunning } from "../ports/stage-runs-running.js";
import { StatsSource, type GrafanaAccess } from "../ports/stats-source.js";
import { failedRead, readFromGrafana, type GrafanaUnread } from "./grafana-reads.js";

/** What is running now, read on every range. */
export interface LoadNow {
  readonly sessionsRunning: number;
  readonly stageRunsRunning: number;
  readonly browserConnectionsOpen: number;
}

/** System health's figures as read for the range, from the Health readings or Grafana. */
export interface HealthReadingsRead extends HealthFigures {
  readonly state: "read";
  readonly from: Date;
  readonly to: Date;
  readonly stepSeconds: number;
  /** On 1 h, when The Office started taking Health readings. */
  readonly readingsSince?: Date;
  /** The blocks whose query failed on a longer range; none on 1 h. */
  readonly unansweredBlocks: readonly HealthBlock[];
  /** The Grafana read, on the longer ranges. */
  readonly address?: string;
}

/** System health (spec 2.11): Load now, and the range's readings or the Grafana state. */
export interface SystemHealthRead {
  readonly range: SystemHealthRange;
  readonly loadNow: LoadNow;
  readonly readings: HealthReadingsRead | GrafanaUnread;
}

/**
 * Reads System health afresh on each read, as the page asks every 5 s on 1 h and every minute on
 * the longer ranges: 1 h from The Office's own Health readings whatever Settings › Telemetry says,
 * the longer ranges from the Grafana in use in the full stats' states, and Load now on every range.
 */
@Injectable()
export class SystemHealth {
  constructor(
    private readonly schedule: Schedule,
    private readonly grafana: GrafanaInUse,
    private readonly source: StatsSource,
    private readonly healthReadings: HealthReadings,
    private readonly sessions: SessionsRunning,
    private readonly stageRuns: StageRunsRunning,
    private readonly connections: BrowserConnections,
  ) {}

  async read(range: SystemHealthRange): Promise<SystemHealthRead> {
    const [loadNow, readings] = await Promise.all([
      this.loadNow(),
      range === "1h" ? this.lastHour() : this.fromGrafana(range),
    ]);
    return { range, loadNow, readings };
  }

  private async loadNow(): Promise<LoadNow> {
    return {
      sessionsRunning: await this.sessions.sessionsWorking(),
      stageRunsRunning: this.stageRuns.count(),
      browserConnectionsOpen: this.connections.openConnections(),
    };
  }

  private lastHour(): Promise<HealthReadingsRead> {
    const span = healthSpanOf("1h", this.schedule.now());
    const hour = this.healthReadings.lastHour();
    return Promise.resolve({
      state: "read",
      from: span.from,
      to: span.to,
      stepSeconds: HEALTH_READING_STEP_SECONDS,
      readingsSince: hour.readingsSince,
      ...lastHourFiguresOf(hour),
      unansweredBlocks: [],
    });
  }

  private fromGrafana(range: GrafanaHealthRange): Promise<HealthReadingsRead | GrafanaUnread> {
    return readFromGrafana(this.grafana, (access) => this.readFrom(access, range));
  }

  /**
   * The blocks Grafana answered, with Unreachable's words on those it didn't; every block failing
   * gives the state of the first, in the blocks' order, as the full stats' reads do. Nothing in the
   * blocks that answered is No data yet, unless some failed.
   */
  private async readFrom(
    access: GrafanaAccess,
    range: GrafanaHealthRange,
  ): Promise<HealthReadingsRead | GrafanaUnread> {
    const { address } = access;
    const span = healthSpanOf(range, this.schedule.now());
    const read = await this.source.systemHealth(access, {
      from: stepStartOf(span.from, span.stepMs),
      to: stepEndOf(span.to, span.stepMs),
      stepSeconds: span.stepMs / 1000,
    });
    const answers = HEALTH_BLOCKS.map((block) => read[block]);
    const answered: Partial<Record<HealthBlock, HealthSeries[HealthBlock]>> = {};
    const unansweredBlocks: HealthBlock[] = [];
    for (const block of HEALTH_BLOCKS) {
      const answer = read[block];
      if (answer.kind === "read") answered[block] = answer.value;
      else unansweredBlocks.push(block);
    }
    const series = answered as Partial<HealthSeries>;
    if (unansweredBlocks.length === HEALTH_BLOCKS.length) return failedRead(address, answers);
    if (holdsNoHealthData(series)) {
      return unansweredBlocks.length > 0
        ? failedRead(address, answers)
        : { state: "no-data", address };
    }
    return {
      state: "read",
      from: span.from,
      to: span.to,
      stepSeconds: span.stepMs / 1000,
      ...grafanaFiguresOf(series, span),
      unansweredBlocks,
      address,
    };
  }
}
