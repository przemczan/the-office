import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  skillEditSchema,
  skillEveryoneChangeSchema,
  skillStateChangeSchema,
  skillUploadQuerySchema,
  writtenSkillSchema,
  type Skill as SkillResponse,
  type SkillEdit,
  type SkillEveryoneChange,
  type SkillReview as SkillReviewResponse,
  type SkillStateChange,
  type SkillUploadQuery,
  type WrittenSkill,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SkillLibrary, type Upload } from "../../application/skill-library.js";
import type { Skill } from "../../domain/skill.js";
import { SkillRefusalsFilter } from "./skill-refusals.filter.js";

@Controller("skills")
@UseFilters(SkillRefusalsFilter)
export class SkillsController {
  constructor(private readonly library: SkillLibrary) {}

  @Get()
  async list(): Promise<SkillResponse[]> {
    return (await this.library.list()).map(toSkillResponse);
  }

  @Post()
  async write(
    @Body(new ContractPipe(writtenSkillSchema)) written: WrittenSkill,
  ): Promise<SkillResponse> {
    return toSkillResponse(await this.library.write(written));
  }

  @Post("uploads")
  async upload(
    @Query(new ContractPipe(skillUploadQuerySchema)) { fileName }: SkillUploadQuery,
    @Body() body: unknown,
  ): Promise<SkillResponse> {
    return toSkillResponse(await this.library.upload(uploadOf(fileName, body)));
  }

  @Get(":name")
  async read(@Param("name") name: string): Promise<SkillResponse> {
    return toSkillResponse(await this.library.read(name));
  }

  @Get(":name/review")
  async review(@Param("name") name: string): Promise<SkillReviewResponse> {
    const { skill, files, instructions, warnings } = await this.library.review(name);
    return {
      skill: toSkillResponse(skill),
      files: files.map(({ path, text, script }) =>
        text === undefined ? { path, script } : { path, text, script },
      ),
      instructions,
      warnings: [...warnings],
    };
  }

  /** The next version of a written skill. */
  @Put(":name")
  async edit(
    @Param("name") name: string,
    @Body(new ContractPipe(skillEditSchema)) edit: SkillEdit,
  ): Promise<SkillResponse> {
    return toSkillResponse(await this.library.edit(name, edit));
  }

  /** The next version of an uploaded skill. */
  @Post(":name/versions")
  async uploadVersion(
    @Param("name") name: string,
    @Query(new ContractPipe(skillUploadQuerySchema)) { fileName }: SkillUploadQuery,
    @Body() body: unknown,
  ): Promise<SkillResponse> {
    return toSkillResponse(await this.library.uploadVersion(name, uploadOf(fileName, body)));
  }

  @Put(":name/state")
  async changeState(
    @Param("name") name: string,
    @Body(new ContractPipe(skillStateChangeSchema)) { state }: SkillStateChange,
  ): Promise<SkillResponse> {
    const skill = state === "on" ? this.library.turnOn(name) : this.library.turnOff(name);
    return toSkillResponse(await skill);
  }

  @Put(":name/everyone")
  async changeEveryone(
    @Param("name") name: string,
    @Body(new ContractPipe(skillEveryoneChangeSchema)) { everyone }: SkillEveryoneChange,
  ): Promise<SkillResponse> {
    return toSkillResponse(await this.library.changeEveryone(name, everyone));
  }

  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("name") name: string): Promise<void> {
    await this.library.remove(name);
  }
}

/** The body `uploadBody` read, which is bytes only when it was sent as `application/octet-stream`. */
function uploadOf(fileName: string, body: unknown): Upload {
  if (!Buffer.isBuffer(body)) {
    throw new BadRequestException("Send the file itself as application/octet-stream.");
  }
  return { fileName, content: new Uint8Array(body) };
}

function toSkillResponse(skill: Skill): SkillResponse {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    version: skill.version,
    filesHash: skill.filesHash,
    state: skill.state,
    everyone: skill.everyone,
    addedAt: skill.addedAt.toISOString(),
    savedAt: skill.savedAt.toISOString(),
  };
}
