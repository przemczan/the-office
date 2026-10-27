import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { activitySchema, type Activity, type Now as NowResponse } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { NotificationService } from "../../application/notification-service.js";
import { NowService } from "../../application/now-service.js";
import { toNowResponse } from "./now-responses.js";

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

  /**
   * The web reports the user active, and on which page: activity tells Since you left where to
   * begin, and opening what a Notification points to handles it.
   */
  @Post("activity")
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordActivity(@Body(new ContractPipe(activitySchema)) { page }: Activity): Promise<void> {
    await this.now.recordActivity();
    await this.notifications.opened(page);
  }
}
