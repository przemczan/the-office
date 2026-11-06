import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  baseBranchFolderQuerySchema,
  type BaseBranchFetch,
  type BaseBranchFolder,
  type BaseBranchFolderQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { BaseBranchFiles } from "../../application/base-branch-files.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/** The files committed on a Project's base branch, for the Repository file browser. */
@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class BaseBranchFilesController {
  constructor(private readonly files: BaseBranchFiles) {}

  @Post(":id/base-branch/fetch")
  @HttpCode(HttpStatus.OK)
  async fetch(@Param("id") id: string): Promise<BaseBranchFetch> {
    const { commit, fetchProblem } = await this.files.fresh(id);
    return { commit, fetchProblem: fetchProblem ?? null };
  }

  @Get(":id/base-branch/:commit/folder")
  async folder(
    @Param("id") id: string,
    @Param("commit") commit: string,
    @Query(new ContractPipe(baseBranchFolderQuerySchema))
    { path, extensions }: BaseBranchFolderQuery,
  ): Promise<BaseBranchFolder> {
    const folder = await this.files.folder(id, commit, path, extensions);
    return { ...folder, entries: [...folder.entries] };
  }
}
