import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineModels,
  EngineReferenceMoves,
  movedStandInList,
  type EngineRemoval,
  type MovedEngineReference,
} from "../../engine/index.js";
import type { Project } from "../domain/project.js";
import { moveEngineLevels } from "../domain/project-changes.js";
import { ProjectRepository } from "../ports/project-repository.js";

/**
 * Moves each Project default naming an engine being removed to the replacement, which gives it its
 * type, its force weighed against the engines listed but the removed one (`moveEngineLevels`), and
 * puts the replacement in its place in each Project's own Stand-in Engine list, used or not;
 * people's settings name engine types, so they stay (spec §5.4.5, "Removing an engine").
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
    return (await this.projectsNaming(removal.engineId)).flatMap((project) =>
      projectLevelMoves(project, removal),
    );
  }

  async moveProjectLevels(removal: EngineRemoval): Promise<void> {
    const projects = await this.projectsNaming(removal.engineId);
    if (projects.length === 0) return;
    const listed = await this.engines.engines();
    for (const project of projects) {
      const { events } = await this.repository.update(project.id, (stored) =>
        moveEngineLevels(stored, removal, listed),
      );
      for (const event of events) await this.events.publish(event);
    }
  }

  private async projectsNaming(engineId: string): Promise<Project[]> {
    return (await this.repository.list()).filter(
      ({ engine }) =>
        engine.default?.engineId === engineId || engine.standIns.engineIds.includes(engineId),
    );
  }
}

/**
 * Where the removal puts the Project's default, when it names the engine; then its own Stand-in
 * Engine list's move, when the list names it (`movedStandInList`).
 */
function projectLevelMoves(project: Project, removal: EngineRemoval): MovedEngineReference[] {
  const where = { id: project.id, name: project.name };
  const projectDefault: MovedEngineReference[] =
    project.engine.default?.engineId === removal.engineId
      ? [
          {
            project: where,
            work: null,
            from: removal.engineId,
            to: removal.replacement?.id ?? null,
          },
        ]
      : [];
  return [
    ...projectDefault,
    ...movedStandInList(project.engine.standIns.engineIds, removal, where),
  ];
}
