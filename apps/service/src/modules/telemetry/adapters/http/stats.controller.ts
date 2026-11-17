import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import {
  basicStatsQuerySchema,
  fullStatsQuerySchema,
  grafanaCheckSchema,
  type GrafanaCheck as GrafanaCheckRequest,
  type GrafanaCheckAnswer,
  type BasicStats as BasicStatsResponse,
  type BasicStatsQuery,
  type FullStats as FullStatsResponse,
  type FullStatsQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { BasicStats } from "../../application/basic-stats.js";
import { FullStats } from "../../application/full-stats.js";
import { GrafanaCheck } from "../../application/grafana-check.js";
import { toBasicStatsResponse, toFullStatsResponse } from "./stats-responses.js";

@Controller("stats")
export class StatsController {
  constructor(
    private readonly basicStats: BasicStats,
    private readonly fullStats: FullStats,
    private readonly grafanaCheck: GrafanaCheck,
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
   * Settings › Telemetry's Test: whether Stats could read the user's own Grafana at the address,
   * with the read token given or, left out, the saved one. Here, not in the platform's settings
   * routes, as only this module reads Grafana.
   */
  @Post("grafana-check")
  @HttpCode(200)
  async checkGrafana(
    @Body(new ContractPipe(grafanaCheckSchema)) { readAddress, readToken }: GrafanaCheckRequest,
  ): Promise<GrafanaCheckAnswer> {
    const answer = await this.grafanaCheck.check(readAddress.trim(), readToken?.trim());
    return answer.state === "no-data-sources"
      ? { ...answer, missing: [...answer.missing] }
      : answer;
  }
}
