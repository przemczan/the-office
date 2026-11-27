import { Controller, Get, Param, UseFilters } from "@nestjs/common";
import {
  type Preset as PresetResponse,
  type Role as RoleResponse,
  type RoleCardOptions,
  type RoleChange as RoleChangeResponse,
  type UserRef as UserRefResponse,
} from "@the-office/contracts";
import { Duties } from "../../application/duties.js";
import type { RoleHistoryEntry } from "../../application/role-history.js";
import { RoleService } from "../../application/role-service.js";
import { hardSwitchesOf, presetAuthority } from "../../domain/authority.js";
import { dutiesSuitedTo, type Preset } from "../../domain/presets.js";
import type { UserRef } from "../../domain/user.js";
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
      engineTypes: options.engineTypes.map(({ type, listed, models, efforts }) => ({
        type,
        listed,
        models: models.map(({ model, onEveryAccount }) => ({ model, onEveryAccount })),
        efforts: [...efforts],
      })),
      engines: options.engines.map(({ engine, missingCapabilities }) => ({
        engine,
        missingCapabilities: [...missingCapabilities],
      })),
      knownRoles: options.knownRoles.map(({ key, title }) => ({ key, title })),
      hardSwitches: options.hardSwitches.map(({ key, enforcement }) => ({ key, enforcement })),
      authority: options.authority.map(({ label, rows }) => ({
        label,
        rows: rows.map(
          ({ group, label: rowLabel, cap, ownAndOthers, followed, enforcedOn, values }) => ({
            group,
            label: rowLabel,
            cap,
            ownAndOthers,
            followed,
            enforcedOn,
            values: [...values],
          }),
        ),
      })),
      fromScratchAuthority: { ...options.fromScratchAuthority },
      mcpToolDefault: { ...options.mcpToolDefault },
      taskLimits: { ...options.taskLimits },
    };
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

  @Get("roles/:key/changes")
  async history(@Param("key") key: string): Promise<RoleChangeResponse[]> {
    return (await this.roles.history(key)).map(toChangeResponse);
  }

  private responseContext(): Promise<RoleResponseContext> {
    return roleResponseContext(this.roles, this.duties);
  }
}

function toPresetResponse(preset: Preset): PresetResponse {
  return {
    roleKey: preset.roleKey,
    suggestedName: preset.suggestedName,
    card: { ...preset.card, hardSwitches: hardSwitchesOf(preset.roleKey, preset.card.authority) },
    presetAuthority: presetAuthority(preset.roleKey),
    duties: dutiesSuitedTo(preset),
  };
}

function toChangeResponse(entry: RoleHistoryEntry): RoleChangeResponse {
  const at = entry.at.toISOString();
  switch (entry.kind) {
    case "hired":
      return {
        kind: "hired",
        at,
        proposedBy: entry.proposedBy ?? null,
        savedBy: userResponse(entry.savedBy),
      };
    case "card-changed":
      return {
        kind: "card-changed",
        at,
        cardVersion: entry.cardVersion,
        changes: entry.changes.map(({ field, from, to }) => ({ field, from, to })),
        proposedBy: entry.proposedBy ?? null,
        savedBy: userResponse(entry.savedBy),
      };
    case "skills-changed":
      return {
        kind: "skills-changed",
        at,
        added: [...entry.added],
        removed: [...entry.removed],
        changedBy: userResponse(entry.changedBy),
      };
  }
}

function userResponse(user: UserRef | null): UserRefResponse | null {
  return user && { userId: user.userId, name: user.name };
}
