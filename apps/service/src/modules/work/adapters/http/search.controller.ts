import { Controller, Get, Query } from "@nestjs/common";
import {
  searchQuerySchema,
  type SearchQuery,
  type SearchResults as SearchResultsResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SearchService } from "../../application/search-service.js";
import { toSearchResultsResponse } from "./work-responses.js";

/** The top bar's search across Work's records; people are matched in the web, from those hired. */
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async everything(
    @Query(new ContractPipe(searchQuerySchema)) { query }: SearchQuery,
  ): Promise<SearchResultsResponse> {
    return toSearchResultsResponse(await this.search.everything(query));
  }
}
