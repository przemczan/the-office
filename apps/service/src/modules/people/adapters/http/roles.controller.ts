import { Body, Controller, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  hireSchema,
  roleCardSchema,
  type Hire,
  type Preset as PresetResponse,
  type Role as RoleResponse,
  type RoleCard,
  type RoleCardOptions,
  type RoleChange as RoleChangeResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { Duties } from "../../application/duties.js";
import type { RoleHistoryEntry } from "../../application/role-history.js";
import { RoleService } from "../../application/role-service.js";
import type { Preset } from "../../domain/presets.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";
import { roleResponseContext, toRoleResponse, type RoleResponseContext } from "./role-responses.js";

@Controller()
@UseFilters(RoleRefusalsFilter)
export class RolesController {
  constructor(
    private readonly roles: RoleService,
    private readonly duties: Duties,
  ) {}

  @Get("presets")
  presets(): PresetResponse[] {
    return this.roles.presets().map(toPresetResponse);
  }

  @Get("role-card-options")
  async cardOptions(): Promise<RoleCardOptions> {
    const options = await this.roles.cardOptions();
    return {
      engines: options.engines.map(({ engine, models, defaultModel, missingCapabilities }) => ({
        engine,
        models: [...models],
        defaultModel,
        missingCapabilities: [...missingCapabilities],
      })),
      knownRoles: options.knownRoles.map(({ key, title }) => ({ key, title })),
      hardSwitches: options.hardSwitches.map(({ key, enforcement }) => ({ key, enforcement })),
      mcpToolDefault: { ...options.mcpToolDefault },
      taskLimits: { ...options.taskLimits },
    };
  }

  @Post("roles")
  async hire(@Body(new ContractPipe(hireSchema)) hiring: Hire): Promise<RoleResponse> {
    const role =
      "card" in hiring
        ? await this.roles.hireFromScratch(...cardAndSkills(hiring.card))
        : await this.roles.hire(hiring.roleKey, hiring.name);
    return toRoleResponse(role, await this.responseContext());
  }

  @Get("roles")
  async list(): Promise<RoleResponse[]> {
    const roles = await this.roles.list();
    const context = await roleResponseContext(this.roles, this.duties, roles);
    return roles.map((role) => toRoleResponse(role, context));
  }

  @Get("roles/:key")
  async read(@Param("key") key: string): Promise<RoleResponse> {
    return toRoleResponse(await this.roles.read(key), await this.responseContext());
  }

  @Put("roles/:key/card")
  async changeCard(
    @Param("key") key: string,
    @Body(new ContractPipe(roleCardSchema)) card: RoleCard,
  ): Promise<RoleResponse> {
    const role = await this.roles.changeCard(key, ...cardAndSkills(card));
    return toRoleResponse(role, await this.responseContext());
  }

  @Post("roles/:key/let-go")
  async letGo(@Param("key") key: string): Promise<RoleResponse> {
    const role = await this.roles.letGo(key);
    return toRoleResponse(role, await this.responseContext());
  }

  @Post("roles/:key/hire-back")
  async hireBack(@Param("key") key: string): Promise<RoleResponse> {
    const role = await this.roles.hireBack(key);
    return toRoleResponse(role, await this.responseContext());
  }

  @Get("roles/:key/changes")
  async history(@Param("key") key: string): Promise<RoleChangeResponse[]> {
    return (await this.roles.history(key)).map(toChangeResponse);
  }

  private responseContext(): Promise<RoleResponseContext> {
    return roleResponseContext(this.roles, this.duties);
  }
}

/** Splits the card the user sent into the Role card and the skills the Skills module keeps. */
function cardAndSkills({ skills, ...card }: RoleCard): [Omit<RoleCard, "skills">, string[]] {
  return [card, skills];
}

function toPresetResponse(preset: Preset): PresetResponse {
  return { roleKey: preset.roleKey, suggestedName: preset.suggestedName, card: preset.card };
}

function toChangeResponse(entry: RoleHistoryEntry): RoleChangeResponse {
  const at = entry.at.toISOString();
  switch (entry.kind) {
    case "hired":
      return { kind: "hired", at, proposedBy: entry.proposedBy ?? null };
    case "card-changed":
      return {
        kind: "card-changed",
        at,
        cardVersion: entry.cardVersion,
        changes: entry.changes.map(({ field, from, to }) => ({ field, from, to })),
        proposedBy: entry.proposedBy ?? null,
      };
    case "skills-changed":
      return { kind: "skills-changed", at, added: [...entry.added], removed: [...entry.removed] };
  }
}
