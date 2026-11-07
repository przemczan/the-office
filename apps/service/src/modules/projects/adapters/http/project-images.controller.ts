import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
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
import { ProjectImages } from "../../application/project-images.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toProjectResponse } from "./project-responses.js";

/**
 * Nothing in an opened file may load or run: an SVG can hold a script, and its address sits on The
 * Office's own origin. `<img>` runs nothing anyway; this holds when the address itself is opened.
 */
const IMAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/** An image's bytes never change, as a new one gets a new id. */
const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

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
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", IMAGE_CONTENT_SECURITY_POLICY);
    response.setHeader("Cache-Control", IMAGE_CACHE_CONTROL);
    return new StreamableFile(content, { type: image.mediaType, disposition: "inline" });
  }
}
