import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import { taskRestartSchema, type TaskRestart } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { TaskRestarts } from "../../application/task-restarts.js";
import { RestartRefusalsFilter } from "./restart-refusals.filter.js";

/** The user's Restart from… on a Task they paused or stopped (spec §2.4.5). */
@Controller("tasks/:id/restart")
@UseFilters(RestartRefusalsFilter)
export class TaskRestartController {
  constructor(private readonly restarts: TaskRestarts) {}

  /** The chosen Stage runs next, with the feedback, if any; refused with every reason (422). */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async restart(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(taskRestartSchema)) { stageKey, feedback }: TaskRestart,
    @SignedIn() signedIn: SignedIn,
  ): Promise<void> {
    await this.restarts.restart(id, { stageKey, feedback }, userOf(signedIn));
  }
}
