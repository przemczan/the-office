import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  stageTemplateCheckRequestSchema,
  type LinkedStage as LinkedStageResponse,
  type PipelineCheck,
  type StageTemplateCheckRequest,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { givenStage } from "./given-stages.js";
import { LinkedStages } from "../../application/linked-stages.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import { toLinkedStageResponse, toStageProblemResponse } from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/**
 * The Stage template editor's check and its linked Stages; adding, saving, applying and deleting a
 * template are Office actions (`LibraryOfficeActions`), and reading the templates is
 * `StageTemplatesController`'s.
 */
@Controller("stage-templates")
@UseFilters(StagesEditRefusalsFilter, PipelineLibraryRefusalsFilter)
export class StageTemplateLibraryController {
  constructor(
    private readonly editor: StageTemplateLibraryEditor,
    private readonly linkedStages: LinkedStages,
  ) {}

  /** What saving the template would be refused for, and what it would only flag; it saves nothing. */
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(new ContractPipe(stageTemplateCheckRequestSchema))
    { stage, stageTemplateId }: StageTemplateCheckRequest,
  ): Promise<PipelineCheck> {
    const { problems, flags } = await this.editor.check(givenStage(stage), stageTemplateId);
    return { problems: [...problems, ...flags].map(toStageProblemResponse) };
  }

  /** The Stages of office-wide and Project Pipelines linked to the template. */
  @Get(":id/linked-stages")
  async linked(@Param("id") id: string): Promise<LinkedStageResponse[]> {
    return (await this.linkedStages.list(id)).map(toLinkedStageResponse);
  }
}
