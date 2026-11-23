import { Controller, Get, Param, UseFilters } from "@nestjs/common";
import {
  roleEngineCascadeSchema,
  type RoleEngineCascade as RoleEngineCascadeResponse,
} from "@the-office/contracts";
import { EngineCascade } from "../../application/engine-cascade.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

/** What the Role card says of the engine cascade; in EngineCascadeModule, which reads Projects. */
@Controller()
@UseFilters(RoleRefusalsFilter)
export class EngineCascadeController {
  constructor(private readonly cascade: EngineCascade) {}

  @Get("roles/:key/engine-cascade")
  async ofRole(@Param("key") key: string): Promise<RoleEngineCascadeResponse> {
    return roleEngineCascadeSchema.parse(await this.cascade.acrossProjects(key));
  }
}
