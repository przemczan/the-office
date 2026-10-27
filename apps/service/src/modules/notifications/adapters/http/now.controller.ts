import { Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type { Now as NowResponse } from "@the-office/contracts";
import { NowService } from "../../application/now-service.js";
import { toNowResponse } from "./now-responses.js";

@Controller()
export class NowController {
  constructor(private readonly now: NowService) {}

  /** Now and the status strip as they stand; `now.changed` brings each change after. */
  @Get("now")
  async read(): Promise<NowResponse> {
    return toNowResponse(await this.now.now());
  }

  /** The web reports the user active while they use it, which tells Since you left where to begin. */
  @Post("activity")
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordActivity(): Promise<void> {
    await this.now.recordActivity();
  }
}
