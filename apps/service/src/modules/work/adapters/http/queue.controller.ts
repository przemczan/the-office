import { Controller, Get, UseFilters } from "@nestjs/common";
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
}
