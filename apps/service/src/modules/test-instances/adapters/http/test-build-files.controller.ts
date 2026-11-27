import { createReadStream } from "node:fs";
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
  UseFilters,
} from "@nestjs/common";
import type { Response } from "express";
import { dispositionOf } from "../../../../platform/http/content-disposition.js";
import { TestBuildLinks } from "../../application/test-build-links.js";
import { TestInstances } from "../../application/test-instances.js";
import { mediaTypeOf } from "../../domain/test-build.js";
import { TestInstanceNotFound } from "../../domain/test-instance-refused.js";
import { TestInstanceRefusalsFilter } from "./test-instance-refusals.filter.js";

/** Where a QR code's link is served, open without sign-in as every `/api/sign-in/**` path is. */
export const TEST_BUILD_LINK_PATH = "sign-in/test-builds";

/**
 * A Built instance's files (spec §2.12, "Build to install"): downloaded behind sign-in, or by the
 * QR code's link (an Office action, `TestInstanceOfficeActionsController`), for one file and an
 * hour, open without sign-in under `/api/sign-in/test-builds/`.
 * A name is served only as the instance lists it; anything else answers 404.
 */
@Controller()
@UseFilters(TestInstanceRefusalsFilter)
export class TestBuildFilesController {
  constructor(
    private readonly instances: TestInstances,
    private readonly links: TestBuildLinks,
  ) {}

  @Get("test-instances/:id/files/:name")
  async download(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("name") name: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return served(name, await this.instances.builtFile(id, name), response);
  }

  /** The file a link is for; a link malformed, tampered with or expired, or its file gone, 404. */
  @Get(`${TEST_BUILD_LINK_PATH}/:token`)
  async downloadByLink(
    @Param("token") token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const linked = await this.links.check(token);
    if (linked === undefined) throw new NotFoundException();
    const path = await this.instances
      .builtFile(linked.instanceId, linked.name)
      .catch((error: unknown) => {
        if (error instanceof TestInstanceNotFound) throw new NotFoundException();
        throw error;
      });
    return served(linked.name, path, response);
  }
}

function served(name: string, path: string, response: Response): StreamableFile {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  return new StreamableFile(createReadStream(path), {
    type: mediaTypeOf(name),
    disposition: dispositionOf("attachment", name),
  });
}
