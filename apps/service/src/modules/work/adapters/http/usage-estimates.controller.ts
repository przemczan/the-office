import { Controller, Get } from "@nestjs/common";
import type { TaskUsageEstimateList } from "@the-office/contracts";
import { UsageEstimates } from "../../application/usage-estimates.js";
import { toUsageEstimateResponse } from "./work-responses.js";

/** The Usage estimates the board and Now show on Ready and queued Tasks. */
@Controller("usage-estimates")
export class UsageEstimatesController {
  constructor(private readonly usageEstimates: UsageEstimates) {}

  /** Every Ready Task's, queued ones too; empty with no measure ticked. */
  @Get()
  async list(): Promise<TaskUsageEstimateList> {
    return (await this.usageEstimates.ofReadyTasks()).map(({ taskId, usageEstimate }) => ({
      taskId,
      usageEstimate: toUsageEstimateResponse(usageEstimate),
    }));
  }
}
