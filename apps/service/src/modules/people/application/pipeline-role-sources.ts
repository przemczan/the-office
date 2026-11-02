import { Injectable } from "@nestjs/common";
import {
  mergedRolesNamed,
  NO_PIPELINE_ROLES,
  type PipelineRolesNamed,
} from "../domain/pipeline-roles-named.js";

/** What some Stages name, and where their sessions run. */
export type PipelineRoleSource = () => Promise<PipelineRolesNamed>;

/**
 * Where the Roles Agent Stages name come from, filled by Pipelines as it starts: Pipelines reaches
 * the engine cascade through Work, so the cascade's module can't import it (the module template's
 * registry). With none registered, no Role is named.
 */
@Injectable()
export class PipelineRoleSources {
  private readonly sources: PipelineRoleSource[] = [];

  register(source: PipelineRoleSource): void {
    this.sources.push(source);
  }

  async rolesNamed(): Promise<PipelineRolesNamed> {
    const named = await Promise.all(this.sources.map((source) => source()));
    return named.reduce(mergedRolesNamed, NO_PIPELINE_ROLES);
  }
}
