import { Controller, Get, Param, Query, Res, UseFilters } from "@nestjs/common";
import {
  issueLinkQuerySchema,
  type IssueLink as IssueLinkResponse,
  type IssueLinkQuery,
  type OpenIssue as OpenIssueResponse,
} from "@the-office/contracts";
import type { Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { IssueImport } from "../../application/issue-import.js";
import { toIssueLinkResponse, toOpenIssueResponse } from "./issue-responses.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/**
 * A Project's GitHub issues (docs/design/issues-as-tasks.html): the open ones not yet imported,
 * their import as Tasks by hand (the Office action import_issues), and the issue a Task was
 * imported from. A repository not on a code host, or not readable now (no one signed in), is
 * refused (422) in the user's words.
 */
@Controller()
@UseFilters(ProjectRefusalsFilter)
export class IssuesController {
  constructor(private readonly issueImport: IssueImport) {}

  /** Newest first, at most 500, each with the Kind it would import as. */
  @Get("projects/:id/issues")
  async openIssues(@Param("id") id: string): Promise<OpenIssueResponse[]> {
    return (await this.issueImport.openIssues(id)).map(toOpenIssueResponse);
  }

  /** The issue the Task was imported from; null when it wasn't, as JSON (Nest sends no body for null). */
  @Get("issue-links")
  async linkOf(
    @Query(new ContractPipe(issueLinkQuerySchema)) { taskId }: IssueLinkQuery,
    @Res() response: Response,
  ): Promise<void> {
    const record = await this.issueImport.linkOf(taskId);
    const answer: IssueLinkResponse | null =
      record === undefined ? null : toIssueLinkResponse(record);
    response.json(answer);
  }
}
