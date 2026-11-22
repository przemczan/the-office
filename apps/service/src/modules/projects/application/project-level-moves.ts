import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineReferenceMoves,
  movedEngineModel,
  movedEngineReference,
  type EngineModel,
  type EngineRemoval,
  type MovedEngineReference,
} from "../../engine/index.js";
import type { Project } from "../domain/project.js";
import { moveEngineLevels } from "../domain/project-changes.js";
import { ProjectRepository } from "../ports/project-repository.js";

/**
 * Moves each Project's default and Role overrides naming an engine being removed to the
 * replacement. Engine's check of the removal has weighed the moved levels already, so they aren't
 * checked again here, as `ProjectService.changeEngineLevels` would.
 */
@Injectable()
export class ProjectLevelMoves implements OnModuleInit {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly events: EventBus,
    private readonly referenceMoves: EngineReferenceMoves,
  ) {}

  onModuleInit(): void {
    this.referenceMoves.register({
      movesOf: (removal) => this.projectLevelMovesOf(removal),
      move: (removal) => this.moveProjectLevels(removal),
    });
  }

  async projectLevelMovesOf(removal: EngineRemoval): Promise<MovedEngineReference[]> {
    return (await this.projectsNaming(removal.engineId)).flatMap((project) =>
      projectLevelMoves(project, removal),
    );
  }

  async moveProjectLevels(removal: EngineRemoval): Promise<void> {
    const move = (reference: EngineModel) => movedEngineModel(reference, removal);
    for (const project of await this.projectsNaming(removal.engineId)) {
      const { events } = await this.repository.update(project.id, (stored) =>
        moveEngineLevels(stored, move),
      );
      for (const event of events) await this.events.publish(event);
    }
  }

  private async projectsNaming(engineId: string): Promise<Project[]> {
    return (await this.repository.list()).filter(({ projectDefault, roleOverrides }) =>
      [projectDefault, ...roleOverrides].some((level) => level?.engineId === engineId),
    );
  }
}

/** Where the removal puts the Project's default and each Role override naming the engine. */
function projectLevelMoves(project: Project, removal: EngineRemoval): MovedEngineReference[] {
  const where = { id: project.id, name: project.name };
  return [
    ...(project.projectDefault
      ? movedEngineReference(project.projectDefault, removal, {
          roleKey: null,
          project: where,
          work: null,
        })
      : []),
    ...project.roleOverrides.flatMap((override) =>
      movedEngineReference(override, removal, {
        roleKey: override.roleKey,
        project: where,
        work: null,
      }),
    ),
  ];
}
