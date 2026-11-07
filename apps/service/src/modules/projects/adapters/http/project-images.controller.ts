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
  type Project as ProjectResponse,
  type ProjectImageFromRepository,
  type ProjectImageKey,
} from "@the-office/contracts";
import type { Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { uploadedBytes } from "../../../../platform/http/upload-body.js";
import { imageContent } from "../../../../platform/images/image-content.js";
import { ProjectImages } from "../../application/project-images.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toProjectResponse } from "./project-responses.js";

@Controller()
@UseFilters(ProjectRefusalsFilter)
export class ProjectImagesController {
  constructor(private readonly images: ProjectImages) {}

  @Post("projects/:id/images/:image")
  async change(
    @Param("id") id: string,
    @Param("image", new ContractPipe(projectImageKeySchema)) image: ProjectImageKey,
    @Body() body: unknown,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.images.change(id, image, uploadedBytes(body)));
  }

  @Post("projects/:id/images/:image/from-repository")
  async changeFromRepository(
    @Param("id") id: string,
    @Param("image", new ContractPipe(projectImageKeySchema)) image: ProjectImageKey,
    @Body(new ContractPipe(projectImageFromRepositorySchema)) file: ProjectImageFromRepository,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.images.changeFromRepository(id, image, file));
  }

  @Delete("projects/:id/images/:image")
  async remove(
    @Param("id") id: string,
    @Param("image", new ContractPipe(projectImageKeySchema)) image: ProjectImageKey,
  ): Promise<ProjectResponse> {
    return toProjectResponse(await this.images.remove(id, image));
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
