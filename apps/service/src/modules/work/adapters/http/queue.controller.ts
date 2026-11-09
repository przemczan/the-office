import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import type { QueuedTask } from "@the-office/contracts";
import { QueueService } from "../../application/queue-service.js";
import { toQueueResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** The one Office-wide queue for Start, as the board, the Task page and Now show it. */
@Controller("queue")
@UseFilters(WorkRefusalsFilter)
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  async list(): Promise<QueuedTask[]> {
    return toQueueResponse(await this.queue.list());
  }

  /** Take out of the queue: the Task stays Ready. */
  @Delete(":taskId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async takeOut(@Param("taskId", ParseUUIDPipe) taskId: string): Promise<void> {
    await this.queue.takeOut(taskId);
  }

  /** Move up: one place, past the Task ahead of it. */
  @Post(":taskId/move-up")
  @HttpCode(HttpStatus.NO_CONTENT)
  async moveUp(@Param("taskId", ParseUUIDPipe) taskId: string): Promise<void> {
    await this.queue.moveUp(taskId);
  }

  /** Move to top: to the first place, ahead of every other queued Task. */
  @Post(":taskId/move-to-top")
  @HttpCode(HttpStatus.NO_CONTENT)
  async moveToTop(@Param("taskId", ParseUUIDPipe) taskId: string): Promise<void> {
    await this.queue.moveToTop(taskId);
  }
}
