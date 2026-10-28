import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  newSavedViewSchema,
  type NewSavedView,
  type SavedView as SavedViewResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SavedViewService } from "../../application/saved-view-service.js";
import { toSavedViewResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** The Work board's "Views": its filters saved under a name. */
@Controller("saved-views")
@UseFilters(WorkRefusalsFilter)
export class SavedViewsController {
  constructor(private readonly savedViews: SavedViewService) {}

  /** Every Saved view, in the order saved. */
  @Get()
  async list(): Promise<SavedViewResponse[]> {
    return (await this.savedViews.list()).map(toSavedViewResponse);
  }

  @Post()
  async save(
    @Body(new ContractPipe(newSavedViewSchema)) given: NewSavedView,
  ): Promise<SavedViewResponse> {
    return toSavedViewResponse(await this.savedViews.save(given));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.savedViews.remove(id);
  }
}
