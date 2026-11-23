import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  stageTemplateCheckRequestSchema,
  stageTemplateEditSchema,
  type PipelineCheck,
  type StageTemplateCheckRequest,
  type StageTemplateEdit,
  type StageTemplate as StageTemplateResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import { toStageProblemResponse, toStageTemplateResponse } from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/** The Stage template editor's changes; reading them is `StageTemplatesController`'s. */
@Controller("stage-templates")
@UseFilters(StagesEditRefusalsFilter, PipelineLibraryRefusalsFilter)
export class StageTemplateLibraryController {
  constructor(private readonly editor: StageTemplateLibraryEditor) {}

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

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.editor.remove(id);
  }
}
