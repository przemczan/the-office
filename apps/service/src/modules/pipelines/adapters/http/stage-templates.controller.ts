import { Controller, Get, Param, UseFilters } from "@nestjs/common";
import type { StageTemplate as StageTemplateResponse } from "@the-office/contracts";
import { UnknownStageTemplate } from "../../domain/pipeline-library-refusals.js";
import { StageTemplateLibrary } from "../../application/stage-template-library.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import { toStageTemplateResponse } from "./pipeline-responses.js";

/** Reading the Stage templates; their editor's changes are `StageTemplateLibraryController`'s. */
@Controller("stage-templates")
@UseFilters(PipelineLibraryRefusalsFilter)
export class StageTemplatesController {
  constructor(private readonly library: StageTemplateLibrary) {}

  @Get()
  async list(): Promise<StageTemplateResponse[]> {
    return (await this.library.list()).map(toStageTemplateResponse);
  }

  @Get(":id")
  async read(@Param("id") id: string): Promise<StageTemplateResponse> {
    const template = await this.library.find(id);
    if (!template) throw new UnknownStageTemplate(id);
    return toStageTemplateResponse(template);
  }
}
