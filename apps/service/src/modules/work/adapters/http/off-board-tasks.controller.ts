import { Controller, Get, Param, UseFilters } from "@nestjs/common";
import type { ProjectOffBoardTasks } from "@the-office/contracts";
import { OffBoardTaskReader } from "../../application/off-board-task-reader.js";
import { toProjectOffBoardTasksResponse } from "./off-board-task-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/**
 * A Project's Off-board Tasks (spec §2.1, "Off-board Tasks"), for its page: served by Work, as the
 * Tasks are Work's, under the Project's path.
 */
@Controller("projects/:id")
@UseFilters(WorkRefusalsFilter)
export class OffBoardTasksController {
  constructor(private readonly reader: OffBoardTaskReader) {}

  /** The latest of each kind, null for a kind it never had, and the earlier Onboard Tasks. */
  @Get("off-board-tasks")
  async ofProject(@Param("id") id: string): Promise<ProjectOffBoardTasks> {
    return toProjectOffBoardTasksResponse(await this.reader.ofProject(id));
  }
}
