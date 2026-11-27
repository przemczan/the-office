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
  pipelineCheckRequestSchema,
  type PipelineCheck,
  type PipelineCheckRequest,
  type PipelinesNeedingFixing,
  type PipelineUse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import { withStagesGiven } from "./given-stages.js";
import { toPipelineUseResponse, toStageProblemResponse } from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/**
 * The library editor's checks and counts; adding, saving and deleting a Pipeline are Office actions
 * (`LibraryOfficeActions`). Reading the library is `PipelinesController`'s, in the library's own
 * module; these ask Projects and Work who uses a Pipeline, so they live with the rest of Pipelines.
 */
@Controller("pipelines")
@UseFilters(StagesEditRefusalsFilter, PipelineLibraryRefusalsFilter)
export class PipelineLibraryController {
  constructor(private readonly editor: PipelineLibraryEditor) {}

  /** What saving the edit would be refused for and what it would only flag; it saves nothing. */
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(new ContractPipe(pipelineCheckRequestSchema))
    { pipelineId, ...edit }: PipelineCheckRequest,
  ): Promise<PipelineCheck> {
    const { problems, flags } = await this.editor.check(withStagesGiven(edit), pipelineId);
    return { problems: [...problems, ...flags].map(toStageProblemResponse) };
  }

  /**
   * The list's "Needs fixing" flags, one answer for the whole library rather than a check per row.
   * Two segments, so `PipelinesController`'s `GET :id` never reads "library" as a Pipeline's id.
   */
  @Get("library/needs-fixing")
  async needingFixing(): Promise<PipelinesNeedingFixing> {
    return { pipelineIds: await this.editor.needingFixing() };
  }

  @Get(":id/use")
  async use(@Param("id") id: string): Promise<PipelineUse> {
    return toPipelineUseResponse(await this.editor.use(id));
  }
}
