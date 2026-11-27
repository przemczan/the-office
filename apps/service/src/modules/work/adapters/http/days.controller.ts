import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import {
  daySummaryQuerySchema,
  TODAY_KEYWORD,
  type DaySummary as DaySummaryResponse,
  type DaySummaryQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { officeDayBounds } from "../../../../platform/office-day.js";
import { DaySummaries } from "../../application/day-summary.js";
import { toDaySummaryResponse } from "./day-summary-response.js";

/** Days: what The Office did on one office day, read from the service's clock. */
@Controller("days")
export class DaysController {
  constructor(private readonly days: DaySummaries) {}

  /** The day's summary; `today` is the service's current office day, and a later day is refused. */
  @Get(":day")
  async read(
    @Param("day") requested: string,
    @Query(new ContractPipe(daySummaryQuerySchema)) { project }: DaySummaryQuery,
  ): Promise<DaySummaryResponse> {
    const today = this.days.today();
    const day = requested === TODAY_KEYWORD ? today : requested;
    if (!officeDayBounds(day)) {
      throw new BadRequestException(
        `"${requested}" is not a day: write it as YYYY-MM-DD or today.`,
      );
    }
    if (day > today) throw new BadRequestException(`${day} is after today, ${today}.`);
    return toDaySummaryResponse(await this.days.read(day, project));
  }
}
