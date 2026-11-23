import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineModels,
  EngineReferenceMoves,
  type Engine,
  type EngineRemoval,
  type MovedEngineReference,
} from "../../engine/index.js";
import type { Project } from "../domain/project.js";
import { moveEngineLevels } from "../domain/project-changes.js";
import { ProjectRepository } from "../ports/project-repository.js";

/**
 * Moves each Project default naming an engine being removed to the replacement, which gives it its
 * type; people's settings name engine types, so they stay (spec §5.4.5, "Removing an engine").
 * Engine's check of the removal has weighed the moved levels already, so they aren't checked again
 * here, as `ProjectService.changeEngine` would.
 */
@Injectable()
export class ProjectLevelMoves implements OnModuleInit {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly events: EventBus,
    private readonly referenceMoves: EngineReferenceMoves,
    private readonly engines: EngineModels,
  ) {}

  onModuleInit(): void {
    this.referenceMoves.register({
      movesOf: (removal) => this.projectLevelMovesOf(removal),
      move: (removal) => this.moveProjectLevels(removal),
    });
  }

  async projectLevelMovesOf(removal: EngineRemoval): Promise<MovedEngineReference[]> {
    const projects = await this.projectsNaming(removal.engineId);
    if (projects.length === 0) return [];
    const removed = await this.engines.find(removal.engineId);
    return projects.flatMap((project) => projectLevelMoves(project, removal, removed));
  }

  async moveProjectLevels(removal: EngineRemoval): Promise<void> {
    for (const project of await this.projectsNaming(removal.engineId)) {
      const { events } = await this.repository.update(project.id, (stored) =>
        moveEngineLevels(stored, removal),
      );
      for (const event of events) await this.events.publish(event);
    }
  }

  private async projectsNaming(engineId: string): Promise<Project[]> {
    return (await this.repository.list()).filter(
      ({ engine }) => engine.default?.engineId === engineId,
    );
  }
}

/**
 * Where the removal puts the Project's default, when it names the engine: an account, shown on
 * each engine's default model as the Office default's move is, since a Project default names no
 * model.
 */
function projectLevelMoves(
  project: Project,
  removal: EngineRemoval,
  removed: Engine | undefined,
): MovedEngineReference[] {
  if (project.engine.default?.engineId !== removal.engineId) return [];
  const { replacement } = removal;
  return [
    {
      roleKey: null,
      project: { id: project.id, name: project.name },
      work: null,
      from: { engineId: removal.engineId, model: removed?.defaultModel ?? "" },
      to: replacement && { engineId: replacement.id, model: replacement.defaultModel },
    },
  ];
}
