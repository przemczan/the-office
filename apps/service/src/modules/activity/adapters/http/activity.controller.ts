import { Controller, Get } from "@nestjs/common";
import type { Activity as ActivityResponse } from "@the-office/contracts";
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
}
