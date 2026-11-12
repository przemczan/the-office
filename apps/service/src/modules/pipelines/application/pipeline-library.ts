import { Injectable } from "@nestjs/common";
import type { Pipeline } from "../domain/pipeline.js";
import { agentStageRoles, commandKeysNamedBy } from "../domain/stage.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";

/** A library Pipeline's name, the Project commands its Stages run, by key, and whether it has a Gate. */
export interface PipelineCommands {
  readonly name: string;
  readonly keys: readonly string[];
  readonly hasGate: boolean;
}

/**
 * The Office-wide library of Pipelines, as other modules read it. The library editor in
 * `PipelineLibraryEditor` changes it.
 */
@Injectable()
export class PipelineLibrary {
  constructor(private readonly repository: PipelineRepository) {}

  async list(): Promise<readonly Pipeline[]> {
    return this.repository.list();
  }

  async find(id: string): Promise<Pipeline | undefined> {
    return this.repository.find(id);
  }

  async has(id: string): Promise<boolean> {
    return (await this.find(id)) !== undefined;
  }

  /**
   * The Pipeline's name and the Project commands, by key, its Stages run (`commandKeysNamedBy`);
   * undefined for a Pipeline the library lacks.
   */
  async commandsNamedBy(id: string): Promise<PipelineCommands | undefined> {
    const pipeline = await this.find(id);
    return (
      pipeline && {
        name: pipeline.name,
        keys: commandKeysNamedBy(pipeline.stages),
        hasGate: pipeline.stages.some(({ kind }) => kind === "gate"),
      }
    );
  }

  /** The Roles the library's Agent Stages name, each once. */
  async rolesNamed(): Promise<ReadonlySet<string>> {
    return agentStageRoles((await this.list()).flatMap((pipeline) => pipeline.stages));
  }
}
