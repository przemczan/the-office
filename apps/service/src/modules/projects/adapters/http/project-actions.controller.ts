import { Body, Controller, Get, Param, Put, UseFilters } from "@nestjs/common";
import {
  actionsEditSchema,
  type Action as ActionResponse,
  type ActionList,
  type ActionsEdit,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { ProjectActions } from "../../application/project-actions.js";
import type { Action } from "../../domain/action.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { byUser } from "./setting-changed-by.js";

/** The Project page's Actions (spec §2.15, "Defining Actions"): saved whole, in order. */
@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectActionsController {
  constructor(private readonly actions: ProjectActions) {}

  @Get(":id/actions")
  async list(@Param("id") id: string): Promise<ActionList> {
    return toResponse(await this.actions.list(id));
  }

  @Put(":id/actions")
  async change(
    @Param("id") id: string,
    @Body(new ContractPipe(actionsEditSchema)) { actions }: ActionsEdit,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ActionList> {
    return toResponse(await this.actions.change(id, actions, userOf(signedIn), byUser(signedIn)));
  }
}

function toResponse(actions: readonly Action[]): ActionList {
  return { actions: actions.map(toActionResponse) };
}

function toActionResponse(action: Action): ActionResponse {
  const head = {
    key: action.key,
    name: action.name,
    leavesTheWorkstation: action.leavesTheWorkstation,
    setBy: { ...action.setBy },
  };
  switch (action.kind) {
    case "project-command":
      return {
        ...head,
        kind: action.kind,
        settings: {
          commandKey: action.settings.commandKey,
          commandsBefore: [...action.settings.commandsBefore],
          timeLimitMinutes: action.settings.timeLimitMinutes,
          projectDeviceId: action.settings.projectDeviceId,
        },
      };
    case "test-target":
      return { ...head, kind: action.kind, settings: { targetKey: action.settings.targetKey } };
    case "workflow":
      return {
        ...head,
        kind: action.kind,
        settings: { file: action.settings.file, inputs: { ...action.settings.inputs } },
      };
  }
}
