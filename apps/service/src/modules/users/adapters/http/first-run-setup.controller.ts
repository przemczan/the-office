import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import type { FirstRunSetup as FirstRunSetupMessage } from "@the-office/contracts";
import { FirstRunSetup } from "../../application/first-run-setup.js";

/**
 * First-run setup's basics after the first user (spec §2.10), for a signed-in device: while they
 * are open, the web leads every page to the wizard; closing them, finished or skipped, is for good.
 */
@Controller("first-run-setup")
export class FirstRunSetupController {
  constructor(private readonly firstRunSetup: FirstRunSetup) {}

  @Get()
  async state(): Promise<FirstRunSetupMessage> {
    return { basics: await this.firstRunSetup.basics() };
  }

  @Post("close")
  @HttpCode(204)
  async close(): Promise<void> {
    await this.firstRunSetup.closeBasics();
  }
}
