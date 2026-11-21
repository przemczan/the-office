import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  activitySeenSchema,
  type Activity as ActivityResponse,
  type ActivitySeen,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { ActivityService } from "../../application/activity-service.js";
import { toActivityResponse } from "./activity-responses.js";

@Controller("activity")
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** The signed-in user's Activity and its count; `activity.changed` tells when to read it again. */
  @Get()
  async read(@SignedIn() { userId }: SignedIn): Promise<ActivityResponse> {
    return toActivityResponse(await this.activity.read(userId));
  }

  /** The signed-in user has seen these items: the ended ones leave their list, not others'. */
  @Post("seen")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markSeen(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(activitySeenSchema)) { itemIds }: ActivitySeen,
  ): Promise<void> {
    await this.activity.markSeen(userId, itemIds);
  }
}
