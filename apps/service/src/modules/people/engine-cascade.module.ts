import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { EngineCascade } from "./application/engine-cascade.js";
import { PeopleModule } from "./people.module.js";
import { KnownProjectLevels } from "./ports/known-project-levels.js";

export interface EngineCascadeModuleOptions {
  /** The modules that provide `knownProjectLevels`. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownProjectLevels: Type<KnownProjectLevels>;
}

/**
 * The engine cascade, apart from PeopleModule so the modules that only read Role cards need no
 * Projects; the composition root binds its port.
 */
@Module({})
export class EngineCascadeModule {
  static register({ imports, knownProjectLevels }: EngineCascadeModuleOptions): DynamicModule {
    return {
      module: EngineCascadeModule,
      imports: [...imports, PeopleModule, EngineModule],
      providers: [{ provide: KnownProjectLevels, useExisting: knownProjectLevels }, EngineCascade],
      exports: [EngineCascade],
    };
  }
}
