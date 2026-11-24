import { Injectable } from "@nestjs/common";
import {
  FireAlarmService,
  initiativeBranchOf,
  InitiativeNotFound,
  InitiativeService,
  TaskService,
} from "../../../work/index.js";
import {
  ActionSources,
  type SourceInitiative,
  type SourceTask,
} from "../../ports/action-sources.js";

type Task = NonNullable<Awaited<ReturnType<TaskService["find"]>>>;

/** Work's Tasks and Initiatives a run runs from, and its fire alarm. */
@Injectable()
export class WorkActionSources extends ActionSources {
  constructor(
    private readonly tasks: TaskService,
    private readonly initiatives: InitiativeService,
    private readonly alarm: FireAlarmService,
  ) {
    super();
  }

  async taskOf(taskId: string): Promise<SourceTask | undefined> {
    const task = await this.tasks.find(taskId);
    if (task === undefined) return undefined;
    return {
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      ended: task.state === "done" || task.state === "dropped",
      branch: ownBranchOf(task),
    };
  }

  async initiativeOf(initiativeId: string): Promise<SourceInitiative | undefined> {
    try {
      const { id, name, state, shortName, branches } = await this.initiatives.read(initiativeId);
      return {
        id,
        name,
        active: state === "active",
        branches:
          shortName === undefined
            ? []
            : branches.map(({ projectId }) => ({
                projectId,
                branch: initiativeBranchOf(shortName),
              })),
      };
    } catch (error) {
      if (error instanceof InitiativeNotFound) return undefined;
      throw error;
    }
  }

  async fireAlarmOn(): Promise<boolean> {
    return (await this.alarm.read()).on;
  }
}

/**
 * The Task's own branch, `office/<task id>`; none for a Publishing Task or a Conflict resolution
 * Task, which work on another's (spec §5.5).
 */
function ownBranchOf(task: Task): string | undefined {
  if (task.madeFor === "publishing" || task.madeFor === "resolve-conflicts") return undefined;
  return `office/${task.id}`;
}
