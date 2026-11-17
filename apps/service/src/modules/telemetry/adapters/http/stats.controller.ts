import { Controller, Get, Query } from "@nestjs/common";
import {
  basicStatsQuerySchema,
  type BasicStats as BasicStatsResponse,
  type BasicStatsQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { BasicStats } from "../../application/basic-stats.js";
import { toBasicStatsResponse } from "./stats-responses.js";

@Controller("stats")
export class StatsController {
  constructor(private readonly basicStats: BasicStats) {}

  /** The basic stats; the Project filter narrows only the figures that belong to a Task. */
  @Get("basic")
  async readBasic(
    @Query(new ContractPipe(basicStatsQuerySchema)) { project }: BasicStatsQuery,
  ): Promise<BasicStatsResponse> {
    return toBasicStatsResponse(await this.basicStats.read(project));
  }
}
