import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseFilters } from "@nestjs/common";
import type { OffBoardTaskStart, ProjectOffBoardTasks } from "@the-office/contracts";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { OffBoardTaskReader } from "../../application/off-board-task-reader.js";
import { OnboardingService } from "../../application/onboarding-service.js";
import {
  toOffBoardTaskStartResponse,
  toProjectOffBoardTasksResponse,
} from "./off-board-task-responses.js";
import { authorOf } from "./signed-in-author.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/**
 * A Project's Off-board Tasks (spec §2.1, "Off-board Tasks"), for its page: served by Work, as the
 * Tasks are Work's, under the Project's path.
 */
@Controller("projects/:id")
@UseFilters(WorkRefusalsFilter)
export class OffBoardTasksController {
  constructor(
    private readonly reader: OffBoardTaskReader,
    private readonly onboarding: OnboardingService,
  ) {}

  /** The latest of each kind, null for a kind it never had, and the earlier Onboard Tasks. */
  @Get("off-board-tasks")
  async ofProject(@Param("id") id: string): Promise<ProjectOffBoardTasks> {
    return toProjectOffBoardTasksResponse(await this.reader.ofProject(id));
  }

  /**
   * Onboard, and Onboard again once the latest Onboard Task is Done or Dropped: started or queued
   * at once, the open one while there is one, or refused with nothing made.
   */
  @Post("onboard")
  @HttpCode(HttpStatus.OK)
  async onboard(
    @Param("id") id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<OffBoardTaskStart> {
    return toOffBoardTaskStartResponse(await this.onboarding.onboard(id, authorOf(signedIn)));
  }
}
