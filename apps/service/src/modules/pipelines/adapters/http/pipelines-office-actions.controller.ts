import { Controller, UseFilters } from "@nestjs/common";
import { PIPELINES_OFFICE_ACTIONS, type OfficeAction } from "@the-office/contracts";
import { officeActionRoutes } from "../../../../platform/http/office-action-routes.js";
import { userOf, type SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { PipelinesOfficeActions } from "../office-actions/pipelines-office-actions.js";
import { GateRefusalsFilter } from "./gate-refusals.filter.js";
import { RestartRefusalsFilter } from "./restart-refusals.filter.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/**
 * The routes of Pipelines' Office actions, each derived from its declaration
 * (PIPELINES_OFFICE_ACTIONS): the signed-in user's request goes to the one handler the action's
 * Office tool calls too. A refused Gate action answers every reason, as a refused Restart from… does, a refused
 * edit of Stages with every problem, and a refused removal of a Project Pipeline with its reasons.
 */
@Controller()
@UseFilters(
  GateRefusalsFilter,
  RestartRefusalsFilter,
  StagesEditRefusalsFilter,
  PipelineLibraryRefusalsFilter,
)
export class PipelinesOfficeActionsController extends officeActionRoutes(PIPELINES_OFFICE_ACTIONS) {
  constructor(private readonly actions: PipelinesOfficeActions) {
    super();
  }

  answer(action: OfficeAction, input: unknown, signedIn: SignedIn): Promise<unknown> {
    return this.actions.answer(action, input, userOf(signedIn));
  }
}
