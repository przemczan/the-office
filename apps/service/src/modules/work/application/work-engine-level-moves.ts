import { Injectable, type OnModuleInit } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineReferenceMoves,
  EngineSettingsChecks,
  movedEngineId,
  movedEngineOverride,
  type EngineId,
  type EngineRemoval,
  type MovedEngineReference,
} from "../../engine/index.js";
import type { Initiative } from "../domain/initiative.js";
import type { Task } from "../domain/task.js";
import { TaskInitiativeEngineOverrideChanged } from "../domain/task-events.js";
import {
  moveInitiativeEngine,
  moveTaskEngine,
  removedEngineChanges,
} from "../domain/work-engine.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { KnownProjects } from "../ports/known-projects.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskEngineChecks } from "./task-engine-checks.js";

/**
 * Moves each Task's and Initiative's engine override naming an engine being removed to the replacement, or
 * to none when it is the only engine (spec 5.4.5), Done, Dropped and archived ones too. The moved
 * levels are weighed before, by the check it registers with Engine's `EngineSettingsChecks`, which
 * Engine runs on the removal: the open Tasks they move go through `TaskEngineChecks`, as
 * `TaskService.setEngine` would, so moving them isn't checked again here.
 */
@Injectable()
export class WorkEngineLevelMoves implements OnModuleInit {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly initiatives: InitiativeRepository,
    private readonly projects: KnownProjects,
    private readonly events: EventBus,
    private readonly referenceMoves: EngineReferenceMoves,
    private readonly engineSettingsChecks: EngineSettingsChecks,
    private readonly engineChecks: TaskEngineChecks,
  ) {}

  onModuleInit(): void {
    this.referenceMoves.register({
      movesOf: (removal) => this.movesOf(removal),
      move: (removal) => this.move(removal),
    });
    this.engineSettingsChecks.register(async ({ removal }) =>
      removal ? this.removalProblems(removal) : [],
    );
  }

  /**
   * Why the removal can't go through for the open Tasks it moves: each Task whose own engine
   * override names the engine, "On “<Task>”", and each Initiative's, over its Tasks with none,
   * "In <Initiative>", weighed at the moved levels.
   */
  async removalProblems(removal: EngineRemoval): Promise<readonly string[]> {
    const [tasks, initiatives] = await Promise.all([this.tasks.list(), this.initiatives.list()]);
    const changes = removedEngineChanges(removal.engineId, tasks, initiatives, (engineId) =>
      movedEngineId(engineId, removal),
    );
    const problems = await readEach(changes, (change) => this.engineChecks.problemsOf(change));
    return problems.flat();
  }

  /**
   * Each Task's engine override naming the removed engine, with its Project, then each
   * Initiative's.
   */
  async movesOf(removal: EngineRemoval): Promise<MovedEngineReference[]> {
    const [tasks, initiatives] = await Promise.all([
      this.tasksNaming(removal.engineId),
      this.initiativesNaming(removal.engineId),
    ]);
    const projectNames = new Map<string, string>();
    for (const projectId of new Set(tasks.map((task) => task.projectId))) {
      projectNames.set(projectId, (await this.projects.find(projectId))?.name ?? projectId);
    }
    return [
      ...tasks.flatMap(({ engineOverride, projectId, id, title, state }) =>
        engineOverride
          ? movedEngineOverride(engineOverride, removal, {
              project: { id: projectId, name: projectNames.get(projectId) ?? projectId },
              work: { kind: "task", id, name: title, state },
            })
          : [],
      ),
      // An Initiative spans its Tasks' Projects, so it names none of them.
      ...initiatives.flatMap(({ engineOverride, id, name, state }) =>
        engineOverride
          ? movedEngineOverride(engineOverride, removal, {
              project: null,
              work: { kind: "initiative", id, name, state },
            })
          : [],
      ),
    ];
  }

  /** Moves them, each Task of a moved Initiative told its Initiative's engine override changed. */
  async move(removal: EngineRemoval): Promise<void> {
    const move = (engineId: EngineId) => movedEngineId(engineId, removal);
    for (const { id } of await this.tasksNaming(removal.engineId)) {
      const { event } = await this.tasks.update(id, (stored) => moveTaskEngine(stored, move));
      if (event) await this.events.publish(event);
    }
    const moved: Initiative[] = [];
    for (const { id } of await this.initiativesNaming(removal.engineId)) {
      const { initiative, event } = await this.initiatives.update(id, (held) =>
        moveInitiativeEngine(held, move),
      );
      if (!event) continue;
      await this.events.publish(event);
      moved.push(initiative);
    }
    if (moved.length === 0) return;
    const inMoved = await this.tasks.inInitiatives(moved.map(({ id }) => id));
    for (const task of inMoved) {
      const initiative = moved.find(({ id }) => id === task.initiativeId);
      if (initiative) {
        await this.events.publish(
          new TaskInitiativeEngineOverrideChanged(task.id, initiative.engineOverride),
        );
      }
    }
  }

  private async tasksNaming(engineId: string): Promise<Task[]> {
    return (await this.tasks.list()).filter((task) => task.engineOverride === engineId);
  }

  private async initiativesNaming(engineId: string): Promise<Initiative[]> {
    return (await this.initiatives.list()).filter(
      (initiative) => initiative.engineOverride === engineId,
    );
  }
}
