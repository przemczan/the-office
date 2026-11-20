import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  type StreamableFile,
  UseFilters,
} from "@nestjs/common";
import {
  projectImageFromRepositorySchema,
  projectImageKeySchema,
  projectImagePaletteSchema,
  type Project as ProjectResponse,
  type ProjectImageFromRepository,
  type ProjectImageKey,
  type ProjectImagePalette,
} from "@the-office/contracts";
import type { Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { uploadedBytes } from "../../../../platform/http/upload-body.js";
import { imageContent } from "../../../../platform/images/image-content.js";
import { ProjectImages } from "../../application/project-images.js";
import { ProjectIssueHosts } from "../../application/project-issue-hosts.js";
import type { Project } from "../../domain/project.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toProjectResponse } from "./project-responses.js";

@Controller()
@UseFilters(ProjectRefusalsFilter)
export class ProjectImagesController {
  constructor(
    private readonly images: ProjectImages,
    private readonly issueHosts: ProjectIssueHosts,
  ) {}

  /** The Project as the API shows it, with its code host read from git's config. */
  private async respond(project: Project): Promise<ProjectResponse> {
    return toProjectResponse(project, await this.issueHosts.codeHostNameOf(project));
  }

  @Post("projects/:id/images/:image/:palette")
  async change(
    @Param("id") id: string,
    @Param("image", new ContractPipe(projectImageKeySchema)) image: ProjectImageKey,
    @Param("palette", new ContractPipe(projectImagePaletteSchema)) palette: ProjectImagePalette,
    @Body() body: unknown,
  ): Promise<ProjectResponse> {
    return this.respond(await this.images.change(id, image, palette, uploadedBytes(body)));
  }

  @Post("projects/:id/images/:image/:palette/from-repository")
  async changeFromRepository(
    @Param("id") id: string,
    @Param("image", new ContractPipe(projectImageKeySchema)) image: ProjectImageKey,
    @Param("palette", new ContractPipe(projectImagePaletteSchema)) palette: ProjectImagePalette,
    @Body(new ContractPipe(projectImageFromRepositorySchema)) file: ProjectImageFromRepository,
  ): Promise<ProjectResponse> {
    return this.respond(await this.images.changeFromRepository(id, image, palette, file));
  }

  @Delete("projects/:id/images/:image/:palette")
  async remove(
    @Param("id") id: string,
    @Param("image", new ContractPipe(projectImageKeySchema)) image: ProjectImageKey,
    @Param("palette", new ContractPipe(projectImagePaletteSchema)) palette: ProjectImagePalette,
  ): Promise<ProjectResponse> {
    return this.respond(await this.images.remove(id, image, palette));
  }

  @Get("projects/:id/images/:imageId/content")
  async content(
    @Param("id") id: string,
    @Param("imageId", ParseUUIDPipe) imageId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { image, content } = await this.images.open(id, imageId);
    return imageContent(response, image.mediaType, content);
  }
}
