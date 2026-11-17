import { Controller, Get, Query } from "@nestjs/common";
import {
  basicStatsQuerySchema,
  fullStatsQuerySchema,
  type BasicStats as BasicStatsResponse,
  type BasicStatsQuery,
  type FullStats as FullStatsResponse,
  type FullStatsQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { BasicStats } from "../../application/basic-stats.js";
import { FullStats } from "../../application/full-stats.js";
import { toBasicStatsResponse, toFullStatsResponse } from "./stats-responses.js";

@Controller("stats")
export class StatsController {
  constructor(
    private readonly basicStats: BasicStats,
    private readonly fullStats: FullStats,
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
}
