import { Body, Controller, Get, Param, Post, Query, Res, UseFilters } from "@nestjs/common";
import {
  issueImportSchema,
  issueLinkQuerySchema,
  type IssueImport as IssueImportRequest,
  type IssueImportResult as IssueImportResultResponse,
  type IssueLink as IssueLinkResponse,
  type IssueLinkQuery,
  type OpenIssue as OpenIssueResponse,
} from "@the-office/contracts";
import type { Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { IssueImport } from "../../application/issue-import.js";
import { toIssueLinkResponse, toOpenIssueResponse } from "./issue-responses.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/**
 * A Project's GitHub issues (docs/design/issues-as-tasks.html): the open ones not yet imported,
 * their import as Tasks by hand, and the issue a Task was imported from. A repository not on a
 * code host, or not readable now (no one signed in), is refused (422) in the user's words.
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

  /** Each issue becomes a Task in Backlog created by the user; one imported already is skipped. */
  @Post("projects/:id/issues/import")
  async import(
    @Param("id") id: string,
    @Body(new ContractPipe(issueImportSchema)) { numbers }: IssueImportRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<IssueImportResultResponse> {
    const { imported, skipped } = await this.issueImport.importByHand(
      id,
      numbers,
      userOf(signedIn),
    );
    return { imported: [...imported], skipped: [...skipped] };
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
