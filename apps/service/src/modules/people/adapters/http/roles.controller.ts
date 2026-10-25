import { Body, Controller, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  hireSchema,
  roleCardEditSchema,
  type Hire,
  type Preset as PresetResponse,
  type Role as RoleResponse,
  type RoleCardEdit,
  type RoleCardOptions,
  type RoleCardVersion as RoleCardVersionResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { RoleService } from "../../application/role-service.js";
import { switchesAskingYouUntilHired } from "../../domain/hard-switches.js";
import type { Preset } from "../../domain/presets.js";
import type { Role, RoleCardVersion } from "../../domain/role.js";
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
  async hire(@Body(new ContractPipe(hireSchema)) { roleKey, name }: Hire): Promise<RoleResponse> {
    const role = await this.roles.hire(roleKey, name);
    return toRoleResponse(role, await this.hiredRoleKeys());
  }

  @Get("roles")
  async list(): Promise<RoleResponse[]> {
    const roles = await this.roles.list();
    const hired = new Set(roles.map((role) => role.key));
    return roles.map((role) => toRoleResponse(role, hired));
  }

  @Get("roles/:key")
  async read(@Param("key") key: string): Promise<RoleResponse> {
    return toRoleResponse(await this.roles.read(key), await this.hiredRoleKeys());
  }

  @Put("roles/:key/card")
  async changeCard(
    @Param("key") key: string,
    @Body(new ContractPipe(roleCardEditSchema)) edit: RoleCardEdit,
  ): Promise<RoleResponse> {
    const role = await this.roles.changeCard(key, edit);
    return toRoleResponse(role, await this.hiredRoleKeys());
  }

  @Get("roles/:key/card-versions")
  async cardVersions(@Param("key") key: string): Promise<RoleCardVersionResponse[]> {
    return (await this.roles.cardVersions(key)).map(toCardVersionResponse);
  }

  private async hiredRoleKeys(): Promise<ReadonlySet<string>> {
    return new Set((await this.roles.list()).map((role) => role.key));
  }
}

function toRoleResponse(role: Role, hiredRoles: ReadonlySet<string>): RoleResponse {
  return {
    key: role.key,
    card: role.card,
    cardVersion: role.cardVersion,
    hiredAt: role.hiredAt.toISOString(),
    cardSavedAt: role.cardSavedAt.toISOString(),
    askingYouUntilHired: switchesAskingYouUntilHired(role.card.hardSwitches, hiredRoles),
  };
}

function toPresetResponse(preset: Preset): PresetResponse {
  return { roleKey: preset.roleKey, suggestedName: preset.suggestedName, card: preset.card };
}

function toCardVersionResponse(version: RoleCardVersion): RoleCardVersionResponse {
  return {
    version: version.version,
    savedAt: version.savedAt.toISOString(),
    changes: version.changes.map(({ field, from, to }) => ({ field, from, to })),
  };
}
