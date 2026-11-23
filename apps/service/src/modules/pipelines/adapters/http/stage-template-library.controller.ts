import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  stageTemplateApplyRequestSchema,
  stageTemplateCheckRequestSchema,
  stageTemplateEditSchema,
  type LinkedStage as LinkedStageResponse,
  type PipelineCheck,
  type StageTemplateApplyRequest,
  type StageTemplateApplyResult,
  type StageTemplateCheckRequest,
  type StageTemplateEdit,
  type StageTemplate as StageTemplateResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { LinkedStages } from "../../application/linked-stages.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import {
  toLinkedStageResponse,
  toStageProblemResponse,
  toStageTemplateResponse,
} from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/**
 * The Stage template editor's changes and its linked Stages; reading the templates is
 * `StageTemplatesController`'s.
 */
@Controller("stage-templates")
@UseFilters(StagesEditRefusalsFilter, PipelineLibraryRefusalsFilter)
export class StageTemplateLibraryController {
  constructor(
    private readonly editor: StageTemplateLibraryEditor,
    private readonly linkedStages: LinkedStages,
  ) {}

  /** A template made from scratch, or from a Stage with Save as template. */
  @Post()
  async add(
    @Body(new ContractPipe(stageTemplateEditSchema)) { stage }: StageTemplateEdit,
  ): Promise<StageTemplateResponse> {
    return toStageTemplateResponse(await this.editor.add(stage));
  }

  /** What saving the template would be refused for, and what it would only flag; it saves nothing. */
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(new ContractPipe(stageTemplateCheckRequestSchema))
    { stage, stageTemplateId }: StageTemplateCheckRequest,
  ): Promise<PipelineCheck> {
    const { problems, flags } = await this.editor.check(stage, stageTemplateId);
    return { problems: [...problems, ...flags].map(toStageProblemResponse) };
  }

  @Put(":id")
  async save(
    @Param("id") id: string,
    @Body(new ContractPipe(stageTemplateEditSchema)) { stage }: StageTemplateEdit,
  ): Promise<StageTemplateResponse> {
    return toStageTemplateResponse(await this.editor.save(id, stage));
  }

  /** The Stages of office-wide and Project Pipelines linked to the template. */
  @Get(":id/linked-stages")
  async linked(@Param("id") id: string): Promise<LinkedStageResponse[]> {
    return (await this.linkedStages.list(id)).map(toLinkedStageResponse);
  }

  /**
   * Gives the chosen linked Stages the template's named fields; a Pipeline refused is named with
   * why, the others still applied.
   */
  @Post(":id/apply")
  @HttpCode(HttpStatus.OK)
  async apply(
    @Param("id") id: string,
    @Body(new ContractPipe(stageTemplateApplyRequestSchema))
    { fields, stages }: StageTemplateApplyRequest,
  ): Promise<StageTemplateApplyResult> {
    const { applied, refused } = await this.linkedStages.apply(id, fields, stages);
    return {
      applied,
      refused: refused.map((pipeline) => ({ ...pipeline, reasons: [...pipeline.reasons] })),
    };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.editor.remove(id);
  }
}
