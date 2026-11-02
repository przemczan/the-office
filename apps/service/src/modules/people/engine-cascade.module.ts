import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { EngineCascadeController } from "./adapters/http/engine-cascade.controller.js";
import { EngineCascade } from "./application/engine-cascade.js";
import { PipelineRoleCapabilityChecks } from "./application/pipeline-role-capability-checks.js";
import { PeopleModule } from "./people.module.js";
import { KnownPipelineRoles } from "./ports/known-pipeline-roles.js";
import { KnownProjectLevels } from "./ports/known-project-levels.js";
import { ProjectLevelsSaves } from "./ports/project-levels-saves.js";

export interface EngineCascadeModuleOptions {
  /** The modules that provide the ports below. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownProjectLevels: Type<KnownProjectLevels>;
  readonly projectLevelsSaves: Type<ProjectLevelsSaves>;
  readonly knownPipelineRoles: Type<KnownPipelineRoles>;
}

/**
 * The engine cascade and the capability check on its saves, apart from PeopleModule so the modules
 * that only read Role cards need no Projects; the composition root binds its ports.
 */
@Module({})
export class EngineCascadeModule {
  static register({
    imports,
    knownProjectLevels,
    projectLevelsSaves,
    knownPipelineRoles,
  }: EngineCascadeModuleOptions): DynamicModule {
    return {
      module: EngineCascadeModule,
      imports: [...imports, PeopleModule, EngineModule],
      controllers: [EngineCascadeController],
      providers: [
        { provide: KnownProjectLevels, useExisting: knownProjectLevels },
        { provide: ProjectLevelsSaves, useExisting: projectLevelsSaves },
        { provide: KnownPipelineRoles, useExisting: knownPipelineRoles },
        EngineCascade,
        PipelineRoleCapabilityChecks,
      ],
      exports: [EngineCascade],
    };
  }
}
