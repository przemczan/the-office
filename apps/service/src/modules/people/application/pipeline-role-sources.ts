import { Injectable } from "@nestjs/common";
import {
  mergedRolesNamed,
  NO_PIPELINE_ROLES,
  type PipelineRolesNamed,
  type RolesAndDuties,
} from "../domain/pipeline-roles-named.js";

/** What some Stages name, and where their sessions run. */
export type PipelineRoleSource = () => Promise<PipelineRolesNamed>;

/** Whom an open Task's Agent Stages name; undefined for a Task with no Stages to work yet. */
export type TaskRoleSource = (taskId: string) => Promise<RolesAndDuties | undefined>;

/**
 * Where the Roles Agent Stages name come from, filled by Pipelines as it starts: Pipelines reaches
 * the engine cascade through Work, so the cascade's module can't import it (the module template's
 * registry). With none registered, no Role is named.
 */
@Injectable()
export class PipelineRoleSources {
  private readonly sources: PipelineRoleSource[] = [];
  private readonly taskSources: TaskRoleSource[] = [];

  register(source: PipelineRoleSource): void {
    this.sources.push(source);
  }

  registerTaskSource(source: TaskRoleSource): void {
    this.taskSources.push(source);
  }

  async rolesNamed(): Promise<PipelineRolesNamed> {
    const named = await Promise.all(this.sources.map((source) => source()));
    return named.reduce(mergedRolesNamed, NO_PIPELINE_ROLES);
  }

  /** Whom the Task's Agent Stages name, by every source; none for a Task no source knows. */
  async rolesNamedByTask(taskId: string): Promise<RolesAndDuties> {
    const named = await Promise.all(this.taskSources.map((source) => source(taskId)));
    return {
      roleKeys: [...new Set(named.flatMap((each) => each?.roleKeys ?? []))],
      dutyKeys: [...new Set(named.flatMap((each) => each?.dutyKeys ?? []))],
    };
  }
}
