import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineReferenceMoves,
  movedEngineModel,
  type EngineModel,
  type EngineRemoval,
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
    this.referenceMoves.register((removal) => this.moveProjectLevels(removal));
  }

  async moveProjectLevels(removal: EngineRemoval): Promise<void> {
    const move = (reference: EngineModel) => movedEngineModel(reference, removal);
    for (const project of await this.repository.list()) {
      if (!namesEngine(project, removal.engineId)) continue;
      const { events } = await this.repository.update(project.id, (stored) =>
        moveEngineLevels(stored, move),
      );
      for (const event of events) await this.events.publish(event);
    }
  }
}

function namesEngine({ projectDefault, roleOverrides }: Project, engineId: string): boolean {
  return [projectDefault, ...roleOverrides].some((level) => level?.engineId === engineId);
}
