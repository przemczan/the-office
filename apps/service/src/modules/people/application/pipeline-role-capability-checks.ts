import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EngineModels, EngineSessions, type EngineCapability } from "../../engine/index.js";
import {
  incapableEngineProblems,
  newlyOnIncapableEngines,
  rolesOnIncapableEngines,
  type PipelineRole,
} from "../domain/pipeline-role-capabilities.js";
import { KnownPipelineRoles } from "../ports/known-pipeline-roles.js";
import { ProjectLevelsSaves, type ProjectLevelsSave } from "../ports/project-levels-saves.js";
import { RoleCards } from "./role-cards.js";

/**
 * Refuses a save of the engine cascade that would newly put a Role a Pipeline names on an engine
 * lacking what its Agent Stages need (spec §5.4). It registers with each level's save as it starts.
 */
@Injectable()
export class PipelineRoleCapabilityChecks implements OnModuleInit {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineModels: EngineModels,
    private readonly engineSessions: EngineSessions,
    private readonly pipelineRoles: KnownPipelineRoles,
    private readonly projectLevelsSaves: ProjectLevelsSaves,
  ) {}

  onModuleInit(): void {
    this.projectLevelsSaves.register((save) => this.projectLevelsSaveProblems(save));
  }

  /** Only the saved Project's sessions change, so only its Roles are weighed. */
  async projectLevelsSaveProblems({
    projectName,
    before,
    after,
  }: ProjectLevelsSave): Promise<readonly string[]> {
    const roles = await this.rolesNamedByPipelines();
    const officeDefault = await this.engineModels.officeDefault();
    const engines = await this.engines();
    const found = newlyOnIncapableEngines(
      rolesOnIncapableEngines(roles, officeDefault, before, engines.missingCapabilities),
      rolesOnIncapableEngines(roles, officeDefault, after, engines.missingCapabilities),
    );
    return incapableEngineProblems(found, {
      roleTitle: (roleKey) => this.roleCards.roleTitle(roleKey),
      engineName: engines.name,
      projectName,
    });
  }

  private async rolesNamedByPipelines(): Promise<PipelineRole[]> {
    const roleKeys = [...(await this.pipelineRoles.rolesNamed())];
    return Promise.all(
      roleKeys.map(async (roleKey) => ({
        roleKey,
        roleOverride: (await this.roleCards.find(roleKey))?.card.roleOverride ?? null,
      })),
    );
  }

  /** What each listed engine lacks, and its name; an engine not listed is left to other checks. */
  private async engines(): Promise<{
    readonly missingCapabilities: (engineId: string) => readonly EngineCapability[];
    readonly name: (engineId: string) => string;
  }> {
    const listed = await this.engineModels.engines();
    const find = (engineId: string) => listed.find(({ id }) => id === engineId);
    return {
      missingCapabilities: (engineId) => {
        const engine = find(engineId);
        return engine ? this.engineSessions.missingCapabilitiesOf(engine) : [];
      },
      name: (engineId) => find(engineId)?.name ?? engineId,
    };
  }
}
