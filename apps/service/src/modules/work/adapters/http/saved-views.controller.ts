import { Controller, Get, UseFilters } from "@nestjs/common";
import type { SavedView as SavedViewResponse } from "@the-office/contracts";
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
}
