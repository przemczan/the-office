import {
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
  skillRolesChangeSchema,
  skillStateChangeSchema,
  skillUploadQuerySchema,
  writtenSkillSchema,
  type Skill as SkillResponse,
  type SkillEdit,
  type SkillEveryoneChange,
  type SkillReview as SkillReviewResponse,
  type SkillRolesChange,
  type SkillStateChange,
  type SkillUploadQuery,
  type WrittenSkill,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { uploadedBytes } from "../../../../platform/http/upload-body.js";
import { RoleSkills } from "../../application/role-skills.js";
import { SkillLibrary } from "../../application/skill-library.js";
import type { Skill } from "../../domain/skill.js";
import { SkillRefusalsFilter } from "./skill-refusals.filter.js";

@Controller("skills")
@UseFilters(SkillRefusalsFilter)
export class SkillsController {
  constructor(
    private readonly library: SkillLibrary,
    private readonly roleSkills: RoleSkills,
  ) {}

  @Get()
  async list(): Promise<SkillResponse[]> {
    const roles = await this.roleSkills.bySkill();
    return (await this.library.list()).map((skill) =>
      toSkillResponse(skill, roles.get(skill.name) ?? []),
    );
  }

  @Post()
  async write(
    @Body(new ContractPipe(writtenSkillSchema)) written: WrittenSkill,
  ): Promise<SkillResponse> {
    return this.response(await this.library.write(written));
  }

  @Post("uploads")
  async upload(
    @Query(new ContractPipe(skillUploadQuerySchema)) { fileName }: SkillUploadQuery,
    @Body() body: unknown,
  ): Promise<SkillResponse> {
    return this.response(await this.library.upload({ fileName, content: uploadedBytes(body) }));
  }

  @Get(":name")
  async read(@Param("name") name: string): Promise<SkillResponse> {
    return this.response(await this.library.read(name));
  }

  @Get(":name/review")
  async review(@Param("name") name: string): Promise<SkillReviewResponse> {
    const { skill, files, instructions, warnings } = await this.library.review(name);
    return {
      skill: await this.response(skill),
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
    return this.response(await this.library.edit(name, edit));
  }

  /** The next version of an uploaded skill. */
  @Post(":name/versions")
  async uploadVersion(
    @Param("name") name: string,
    @Query(new ContractPipe(skillUploadQuerySchema)) { fileName }: SkillUploadQuery,
    @Body() body: unknown,
  ): Promise<SkillResponse> {
    return this.response(
      await this.library.uploadVersion(name, { fileName, content: uploadedBytes(body) }),
    );
  }

  @Put(":name/state")
  async changeState(
    @Param("name") name: string,
    @Body(new ContractPipe(skillStateChangeSchema)) { state }: SkillStateChange,
  ): Promise<SkillResponse> {
    const skill = state === "on" ? this.library.turnOn(name) : this.library.turnOff(name);
    return this.response(await skill);
  }

  @Put(":name/everyone")
  async changeEveryone(
    @Param("name") name: string,
    @Body(new ContractPipe(skillEveryoneChangeSchema)) { everyone }: SkillEveryoneChange,
  ): Promise<SkillResponse> {
    return this.response(await this.library.changeEveryone(name, everyone));
  }

  @Put(":name/roles")
  async assign(
    @Param("name") name: string,
    @Body(new ContractPipe(skillRolesChangeSchema)) { roles }: SkillRolesChange,
  ): Promise<SkillResponse> {
    const assigned = await this.roleSkills.assignSkill(name, roles);
    return toSkillResponse(await this.library.read(name), assigned);
  }

  @Delete(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("name") name: string): Promise<void> {
    await this.library.remove(name);
  }

  private async response(skill: Skill): Promise<SkillResponse> {
    return toSkillResponse(skill, (await this.roleSkills.bySkill()).get(skill.name) ?? []);
  }
}

function toSkillResponse(skill: Skill, roles: readonly string[]): SkillResponse {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    ...(skill.installedFrom && { installedFrom: skill.installedFrom }),
    version: skill.version,
    filesHash: skill.filesHash,
    state: skill.state,
    everyone: skill.everyone,
    roles: [...roles],
    addedAt: skill.addedAt.toISOString(),
    savedAt: skill.savedAt.toISOString(),
  };
}
