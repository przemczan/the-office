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
  newPipelineSchema,
  pipelineCheckRequestSchema,
  pipelineEditSchema,
  type NewPipeline,
  type PipelineCheck,
  type PipelineCheckRequest,
  type Pipeline as PipelineResponse,
  type PipelineEdit,
  type PipelineUse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import {
  toPipelineResponse,
  toPipelineUseResponse,
  toProjectPipelineBreakResponse,
  toStageProblemResponse,
} from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/**
 * The library editor's changes. Reading the library is `PipelinesController`'s, in the library's own
 * module; these ask Projects and Work who uses a Pipeline, so they live with the rest of Pipelines.
 */
@Controller("pipelines")
@UseFilters(StagesEditRefusalsFilter, PipelineLibraryRefusalsFilter)
export class PipelineLibraryController {
  constructor(private readonly editor: PipelineLibraryEditor) {}

  /** A Pipeline made from scratch, or a copy of one under a name of its own. */
  @Post()
  async add(
    @Body(new ContractPipe(newPipelineSchema)) given: NewPipeline,
  ): Promise<PipelineResponse> {
    const pipeline =
      "copyOf" in given ? await this.editor.copy(given.copyOf) : await this.editor.add(given);
    return toPipelineResponse(pipeline);
  }

  /**
   * What saving the edit would be refused for, what it would only flag, and the Project Pipelines
   * it would leave Broken, which never refuses it; it saves nothing.
   */
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(new ContractPipe(pipelineCheckRequestSchema))
    { pipelineId, ...edit }: PipelineCheckRequest,
  ): Promise<PipelineCheck> {
    const { problems, flags, breaks } = await this.editor.check(edit, pipelineId);
    return {
      problems: problems.map(toStageProblemResponse),
      flags: flags.map(toStageProblemResponse),
      breaks: breaks.map(toProjectPipelineBreakResponse),
    };
  }

  @Put(":id")
  async save(
    @Param("id") id: string,
    @Body(new ContractPipe(pipelineEditSchema)) edit: PipelineEdit,
  ): Promise<PipelineResponse> {
    return toPipelineResponse(await this.editor.save(id, edit));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.editor.remove(id);
  }

  @Get(":id/use")
  async use(@Param("id") id: string): Promise<PipelineUse> {
    return toPipelineUseResponse(await this.editor.use(id));
  }
}
