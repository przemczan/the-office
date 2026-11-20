import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseFilters } from "@nestjs/common";
import type { TestTargetsSetUp } from "@the-office/contracts";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { TestTargetsSetUps } from "../../application/test-targets-set-ups.js";
import type { Task } from "../../domain/task.js";
import { authorOf } from "./signed-in-author.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** The Project page's Set up test targets: the Project's open "Set up test targets" Task. */
@Controller("projects/:id/test-targets")
@UseFilters(WorkRefusalsFilter)
export class TestTargetsSetUpsController {
  constructor(private readonly setUps: TestTargetsSetUps) {}

  @Get("set-up-task")
  async read(@Param("id") id: string): Promise<TestTargetsSetUp> {
    return toResponse(await this.setUps.openOf(id));
  }

  /** The open set-up Task, or one added now, Ready for the user's Start. */
  @Post("set-up")
  @HttpCode(HttpStatus.OK)
  async setUp(@Param("id") id: string, @SignedIn() signedIn: SignedIn): Promise<TestTargetsSetUp> {
    return toResponse(await this.setUps.add(id, authorOf(signedIn)));
  }
}

function toResponse(task: Task | undefined): TestTargetsSetUp {
  return { setUpTask: task ? { id: task.id, title: task.title, state: task.state } : null };
}
