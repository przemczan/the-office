import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import type { ConflictResolutionAnswer } from "@the-office/contracts";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { ConflictResolutions } from "../../application/conflict-resolutions.js";
import { QueueService } from "../../application/queue-service.js";
import { authorOf } from "./signed-in-author.js";
import { toQueueResponse, toTaskResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

@Controller("tasks")
@UseFilters(WorkRefusalsFilter)
export class ConflictResolutionsController {
  constructor(
    private readonly conflictResolutions: ConflictResolutions,
    private readonly queue: QueueService,
  ) {}

  /**
   * Resolve conflicts on the pull request the Task opened: its open Conflict resolution Task, or one
   * made and started now; Ready with Start's reasons when Start refused it.
   */
  @Post(":id/resolve-conflicts")
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ConflictResolutionAnswer> {
    const { task, startRefusal } = await this.conflictResolutions.resolve(id, authorOf(signedIn));
    const queued = toQueueResponse(await this.queue.list()).find(
      ({ taskId }) => taskId === task.id,
    );
    return {
      task: toTaskResponse(task),
      queued: queued ?? null,
      startRefusal: startRefusal === undefined ? null : [...startRefusal],
    };
  }
}
