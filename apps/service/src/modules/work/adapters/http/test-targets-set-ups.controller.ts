import { Controller, Get, Param, UseFilters } from "@nestjs/common";
import type { TestTargetsSetUp } from "@the-office/contracts";
import { TestTargetsSetUps } from "../../application/test-targets-set-ups.js";
import type { Task } from "../../domain/task.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** The Project page's Set up test targets: an open "Set up test targets" Task made before. */
@Controller("projects/:id/test-targets")
@UseFilters(WorkRefusalsFilter)
export class TestTargetsSetUpsController {
  constructor(private readonly setUps: TestTargetsSetUps) {}

  @Get("set-up-task")
  async read(@Param("id") id: string): Promise<TestTargetsSetUp> {
    return toResponse(await this.setUps.openOf(id));
  }
}

function toResponse(task: Task | undefined): TestTargetsSetUp {
  return { setUpTask: task ? { id: task.id, title: task.title, state: task.state } : null };
}
