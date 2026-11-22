import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  userActivityReportSchema,
  type UserActivityReport,
  type Now as NowResponse,
  type SinceYouLeft as SinceYouLeftResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { NotificationService } from "../../application/notification-service.js";
import { NowService } from "../../application/now-service.js";
import { toNowResponse, toSinceYouLeftResponse } from "./now-responses.js";

@Controller()
export class NowController {
  constructor(
    private readonly now: NowService,
    private readonly notifications: NotificationService,
  ) {}

  /** Now and the status strip as they stand; `now.changed` brings each change after. */
  @Get("now")
  async read(): Promise<NowResponse> {
    return toNowResponse(await this.now.now());
  }

  /** The requester's own Since you left, which the web reads again on each `now.changed`. */
  @Get("now/since-you-left")
  async readSinceYouLeft(@SignedIn() { userId }: SignedIn): Promise<SinceYouLeftResponse> {
    return toSinceYouLeftResponse(await this.now.sinceYouLeft(userId));
  }

  /**
   * The web reports the signed-in user active, and on which page: activity tells their Since you
   * left where to begin, and opening what a Notification points to handles it.
   */
  @Post("activity")
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordActivity(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(userActivityReportSchema)) { page }: UserActivityReport,
  ): Promise<void> {
    await this.now.recordActivity(userId);
    await this.notifications.opened(page);
  }
}
