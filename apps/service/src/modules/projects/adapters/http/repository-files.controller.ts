import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseFilters,
} from "@nestjs/common";
import {
  FILE_PREVIEW_BYTES,
  projectBranchesQuerySchema,
  repositoryFilePreviewQuerySchema,
  repositoryFileQuerySchema,
  repositoryFolderQuerySchema,
  type BaseBranchFetch,
  type ProjectBranch,
  type ProjectBranches,
  type ProjectBranchesQuery,
  type RepositoryFilePreview,
  type RepositoryFilePreviewQuery,
  type RepositoryFileQuery,
  type RepositoryFolder,
  type RepositoryFolderQuery,
} from "@the-office/contracts";
import type { Response } from "express";
import { dispositionOf } from "../../../../platform/http/content-disposition.js";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { RepositoryFiles } from "../../application/repository-files.js";
import type { BranchTip } from "../../ports/git.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/**
 * A repository's file is served on The Office's own origin, so nothing in it may run: no script, no
 * request, no form, whatever the browser takes it for. Inline styles let an SVG draw as it should.
 */
const FILE_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** The files committed on a Project's branches, for the Repository file browser and the Files tab. */
@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class RepositoryFilesController {
  constructor(private readonly files: RepositoryFiles) {}

  @Post(":id/base-branch/fetch")
  @HttpCode(HttpStatus.OK)
  async fetch(@Param("id") id: string): Promise<BaseBranchFetch> {
    const { commit, fetchProblem } = await this.files.fresh(id);
    return { commit, fetchProblem: fetchProblem ?? null };
  }

  @Get(":id/branches")
  async branches(
    @Param("id") id: string,
    @Query(new ContractPipe(projectBranchesQuerySchema)) { fetch }: ProjectBranchesQuery,
  ): Promise<ProjectBranches> {
    const { baseBranch, branches, fetchProblem } = await this.files.branches(id, { fetch });
    return {
      baseBranch: toProjectBranch(baseBranch),
      branches: branches.map(toProjectBranch),
      fetchProblem: fetchProblem ?? null,
    };
  }

  @Get(":id/commits/:commit/folder")
  async folder(
    @Param("id") id: string,
    @Param("commit") commit: string,
    @Query(new ContractPipe(repositoryFolderQuerySchema))
    { path, extensions }: RepositoryFolderQuery,
  ): Promise<RepositoryFolder> {
    const folder = await this.files.folder(id, commit, path, extensions);
    return { ...folder, entries: [...folder.entries] };
  }

  /** The file's bytes, typed by what they are; a commit's file never changes, so it is kept. */
  @Get(":id/commits/:commit/file")
  async file(
    @Param("id") id: string,
    @Param("commit") commit: string,
    @Query(new ContractPipe(repositoryFileQuerySchema)) { path, download }: RepositoryFileQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.files.download(id, commit, path);
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", FILE_CONTENT_SECURITY_POLICY);
    return new StreamableFile(file.bytes, {
      type: file.mediaType,
      disposition: dispositionOf(download ? "attachment" : "inline", file.name),
    });
  }

  @Get(":id/commits/:commit/file-preview")
  async preview(
    @Param("id") id: string,
    @Param("commit") commit: string,
    @Query(new ContractPipe(repositoryFilePreviewQuerySchema)) { path }: RepositoryFilePreviewQuery,
  ): Promise<RepositoryFilePreview> {
    return this.files.preview(id, commit, path, FILE_PREVIEW_BYTES);
  }
}

function toProjectBranch({ name, kind, commit }: BranchTip): ProjectBranch {
  return { name, kind, commit };
}
