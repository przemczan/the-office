import { Controller, Get, Query } from "@nestjs/common";
import {
  basicStatsQuerySchema,
  fullStatsQuerySchema,
  systemHealthQuerySchema,
  type BasicStats as BasicStatsResponse,
  type BasicStatsQuery,
  type FullStats as FullStatsResponse,
  type FullStatsQuery,
  type SystemHealth as SystemHealthResponse,
  type SystemHealthQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { BasicStats } from "../../application/basic-stats.js";
import { FullStats } from "../../application/full-stats.js";
import { GrafanaCheck } from "../../application/grafana-check.js";
import { SystemHealth } from "../../application/system-health.js";
import {
  toBasicStatsResponse,
  toFullStatsResponse,
  toSystemHealthResponse,
} from "./stats-responses.js";

@Controller("stats")
export class StatsController {
  constructor(
    private readonly basicStats: BasicStats,
    private readonly fullStats: FullStats,
    private readonly grafanaCheck: GrafanaCheck,
    private readonly systemHealth: SystemHealth,
  ) {}

  /** The basic stats; the Project filter narrows only the figures that belong to a Task. */
  @Get("basic")
  async readBasic(
    @Query(new ContractPipe(basicStatsQuerySchema)) { project }: BasicStatsQuery,
  ): Promise<BasicStatsResponse> {
    return toBasicStatsResponse(await this.basicStats.read(project));
  }

  /**
   * The full stats from the Grafana in use, or the state that keeps them from showing; the Project
   * filter narrows all but the Usage windows.
   */
  @Get("full")
  async readFull(
    @Query(new ContractPipe(fullStatsQuerySchema)) { range, split, project }: FullStatsQuery,
  ): Promise<FullStatsResponse> {
    return toFullStatsResponse(await this.fullStats.read({ range, split }, project));
  }

  /**
   * System health, Office-wide: Load now, and the range's readings, 1 h from The Office's own
   * Health readings whatever Settings › Telemetry says, the longer ranges from the Grafana in use.
   */
  @Get("system-health")
  async readSystemHealth(
    @Query(new ContractPipe(systemHealthQuerySchema)) { range }: SystemHealthQuery,
  ): Promise<SystemHealthResponse> {
    return toSystemHealthResponse(await this.systemHealth.read(range));
  }
}
