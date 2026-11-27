import { Body, Controller, Get, Param, Post, Query, UseFilters } from "@nestjs/common";
import {
  skillUpdateDiffQuerySchema,
  skillUploadQuerySchema,
  type Skill as SkillResponse,
  type SkillReview as SkillReviewResponse,
  type SkillUpdateDiff,
  type SkillUpdateDiffQuery,
  type SkillUploadQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { uploadedBytes } from "../../../../platform/http/upload-body.js";
import { RoleSkills } from "../../application/role-skills.js";
import { SkillLibrary } from "../../application/skill-library.js";
import { SkillUpdates } from "../../application/skill-updates.js";
import { SkillUses } from "../../application/skill-uses.js";
import type { PinnedVersion } from "../../domain/installed-source.js";
import type { Skill } from "../../domain/skill.js";
import { SkillRefusalsFilter } from "./skill-refusals.filter.js";
import { skillResponseOf, toSkillResponse } from "./skill-responses.js";

@Controller("skills")
@UseFilters(SkillRefusalsFilter)
export class SkillsController {
  constructor(
    private readonly library: SkillLibrary,
    private readonly roleSkills: RoleSkills,
    private readonly updates: SkillUpdates,
    private readonly uses: SkillUses,
  ) {}

  @Get()
  async list(): Promise<SkillResponse[]> {
    const [skills, roles, uses] = await Promise.all([
      this.library.list(),
      this.roleSkills.bySkill(),
      this.uses.libraryCounts(),
    ]);
    return skills.map((skill) =>
      toSkillResponse(skill, roles.get(skill.name) ?? [], uses.get(skill.name) ?? 0),
    );
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

  /** Reads the skill's Source, so it answers once git has fetched both versions. */
  @Get(":name/update-diff")
  async updateDiff(
    @Param("name") name: string,
    @Query(new ContractPipe(skillUpdateDiffQuerySchema)) query: SkillUpdateDiffQuery,
  ): Promise<SkillUpdateDiff> {
    const from = pinnedVersion(query.fromTag, query.fromCommit);
    const to = pinnedVersion(query.toTag, query.toCommit);
    const { diff, diffCut } = await this.updates.diff(name, from, to);
    return { from, to, diff, diffCut };
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

  private response(skill: Skill): Promise<SkillResponse> {
    return skillResponseOf(skill, this.roleSkills, this.uses);
  }
}

function pinnedVersion(tag: string | undefined, commit: string): PinnedVersion {
  return tag === undefined ? { commit } : { tag, commit };
}
