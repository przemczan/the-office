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
import type { RoleHistoryEntry } from "../../application/role-history.js";
import { RoleService, type RoleWithSkills } from "../../application/role-service.js";
import { switchesAskingYouUntilHired } from "../../domain/hard-switches.js";
import type { Preset } from "../../domain/presets.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

@Controller()
@UseFilters(RoleRefusalsFilter)
export class RolesController {
  constructor(private readonly roles: RoleService) {}

  @Get("presets")
  presets(): PresetResponse[] {
    return this.roles.presets().map(toPresetResponse);
  }

  @Get("role-card-options")
  cardOptions(): RoleCardOptions {
    const options = this.roles.cardOptions();
    return {
      engines: options.engines.map(({ engine, models }) => ({ engine, models: [...models] })),
      knownRoles: options.knownRoles.map(({ key, title }) => ({ key, title })),
      hardSwitches: options.hardSwitches.map(({ key, enforcement }) => ({ key, enforcement })),
      taskLimits: { ...options.taskLimits },
    };
  }

  @Post("roles")
  async hire(@Body(new ContractPipe(hireSchema)) hiring: Hire): Promise<RoleResponse> {
    const role =
      "card" in hiring
        ? await this.roles.hireFromScratch(...cardAndSkills(hiring.card))
        : await this.roles.hire(hiring.roleKey, hiring.name);
    return toRoleResponse(role, await this.hiredRoleKeys());
  }

  @Get("roles")
  async list(): Promise<RoleResponse[]> {
    const roles = await this.roles.list();
    const hired = new Set(roles.map(({ role }) => role.key));
    return roles.map((role) => toRoleResponse(role, hired));
  }

  @Get("roles/:key")
  async read(@Param("key") key: string): Promise<RoleResponse> {
    return toRoleResponse(await this.roles.read(key), await this.hiredRoleKeys());
  }

  @Put("roles/:key/card")
  async changeCard(
    @Param("key") key: string,
    @Body(new ContractPipe(roleCardSchema)) card: RoleCard,
  ): Promise<RoleResponse> {
    const role = await this.roles.changeCard(key, ...cardAndSkills(card));
    return toRoleResponse(role, await this.hiredRoleKeys());
  }

  @Get("roles/:key/changes")
  async history(@Param("key") key: string): Promise<RoleChangeResponse[]> {
    return (await this.roles.history(key)).map(toChangeResponse);
  }

  private async hiredRoleKeys(): Promise<ReadonlySet<string>> {
    return new Set((await this.roles.list()).map(({ role }) => role.key));
  }
}

/** Splits the card the user sent into the Role card and the skills the Skills module keeps. */
function cardAndSkills({ skills, ...card }: RoleCard): [Omit<RoleCard, "skills">, string[]] {
  return [card, skills];
}

function toRoleResponse(
  { role, skills }: RoleWithSkills,
  hiredRoles: ReadonlySet<string>,
): RoleResponse {
  return {
    key: role.key,
    card: { ...role.card, skills: [...skills] },
    cardVersion: role.cardVersion,
    hiredAt: role.hiredAt.toISOString(),
    cardSavedAt: role.cardSavedAt.toISOString(),
    askingYouUntilHired: switchesAskingYouUntilHired(role.card.hardSwitches, hiredRoles),
  };
}

function toPresetResponse(preset: Preset): PresetResponse {
  return { roleKey: preset.roleKey, suggestedName: preset.suggestedName, card: preset.card };
}

function toChangeResponse(entry: RoleHistoryEntry): RoleChangeResponse {
  const at = entry.at.toISOString();
  switch (entry.kind) {
    case "hired":
      return { kind: "hired", at };
    case "card-changed":
      return {
        kind: "card-changed",
        at,
        cardVersion: entry.cardVersion,
        changes: entry.changes.map(({ field, from, to }) => ({ field, from, to })),
      };
    case "skills-changed":
      return { kind: "skills-changed", at, added: [...entry.added], removed: [...entry.removed] };
  }
}
