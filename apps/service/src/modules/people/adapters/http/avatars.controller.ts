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
import type { Role as RoleResponse } from "@the-office/contracts";
import type { Response } from "express";
import { uploadedBytes } from "../../../../platform/http/upload-body.js";
import { imageContent } from "../../../../platform/images/image-content.js";
import { PersonAvatars } from "../../application/person-avatars.js";
import { RoleService } from "../../application/role-service.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";
import { filledKeys, toRoleResponse } from "./role-responses.js";

@Controller("roles/:key/avatar")
@UseFilters(RoleRefusalsFilter)
export class AvatarsController {
  constructor(
    private readonly avatars: PersonAvatars,
    private readonly roles: RoleService,
  ) {}

  @Post()
  async change(@Param("key") key: string, @Body() body: unknown): Promise<RoleResponse> {
    await this.avatars.change(key, uploadedBytes(body));
    return this.roleOf(key);
  }

  @Delete()
  async remove(@Param("key") key: string): Promise<RoleResponse> {
    await this.avatars.remove(key);
    return this.roleOf(key);
  }

  @Get(":imageId/content")
  async content(
    @Param("key") key: string,
    @Param("imageId", ParseUUIDPipe) imageId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { avatar, content } = await this.avatars.open(key, imageId);
    return imageContent(response, avatar.mediaType, content);
  }

  private async roleOf(key: string): Promise<RoleResponse> {
    return toRoleResponse(await this.roles.read(key), filledKeys(await this.roles.list()));
  }
}
