import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
import { makeAPlanOpening, PLANNER, PLANNING_THREAD_TITLE } from "../domain/planning.js";
import {
  acceptInAutoMode,
  confirmDefinitionOfDone,
  confirmPipeline,
  confirmPlan,
  markingPlannedProblems,
  proposeDefinitionOfDone,
  proposePipeline,
  proposePlan,
  saveDefinitionOfDone,
  savePlan,
} from "../domain/planning-changes.js";
import type { PlanWriting } from "../domain/written-parts.js";
import type { ProposedPipeline, Task } from "../domain/task.js";
import {
  markTaskReady,
  startPlanningTask,
  undoPlanningMove,
  type TaskChange,
} from "../domain/task-changes.js";
import type { TaskDefinitionOfDoneSaved, TaskPlanSaved } from "../domain/task-events.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { MOVED_AS_IT_OPENED } from "../domain/task-move.js";
import { TaskRefused } from "../domain/task-refused.js";
import { readinessLines, stateChangeProblems, type ReadinessLine } from "../domain/task-states.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskDecisions } from "../ports/task-decisions.js";
import { TaskThreads } from "../ports/task-threads.js";
import { WorkSettings } from "../ports/work-settings.js";
import { IdeaService } from "./idea-service.js";

/**
 * Planning a Task as a conversation with the Planner (spec §2.1): its own worktree on the freshly
 * fetched base branch, and a planning Thread. Plan with… opens it for the user's first message, so
 * a Plan the user writes alone costs no model call; Make a plan has the Planner start at once from
 * the record. The Planner proposes the Plan, the Definition of Done and a Pipeline; the user
 * confirms them and marks the Task Ready. Planning is optional: the user may save and confirm
 * both parts in Backlog and mark the Task Ready from there.
 */

/** How the Planner joins the planning Thread: on the user's first message, or at once. */
type PlannerJoins = "on-first-message" | "at-once";

/**
 * What marking a Task planned did: nothing, as the user confirms; nothing yet, as a Decision on it
 * is open; or, in auto mode, accepted it as Ready.
 */
export type MarkedPlanned =
  | { readonly outcome: "for-the-user" }
  | { readonly outcome: "waiting-for-a-decision"; readonly openDecisions: number }
  | { readonly outcome: "ready"; readonly task: Task };

@Injectable()
export class PlanningService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly ideas: IdeaService,
    private readonly people: KnownPeople,
    private readonly pipelines: KnownPipelines,
    private readonly worktrees: ProjectWorktrees,
    private readonly threads: TaskThreads,
    private readonly decisions: TaskDecisions,
    private readonly settings: WorkSettings,
    private readonly events: EventBus,
  ) {}

  /**
   * Plan with…: Backlog → Planning, the Planner waiting for the user's first message, with auto
   * mode off. A Task in Planning already stays as it is, with its Thread; refused with the reason
   * from any other state, or while nobody is the Planner.
   */
  async plan(taskId: string): Promise<Task> {
    return this.startPlanning(taskId, "on-first-message", false);
  }

  /**
   * Make a plan: as Plan with…, but the Planner starts at once from the title and Description, in
   * auto mode or not as the user chose, which becomes the remembered default.
   */
  async makeAPlan(taskId: string, autoMode: boolean): Promise<Task> {
    const task = await this.startPlanning(taskId, "at-once", autoMode);
    await this.settings.changeAutoMode(autoMode);
    return task;
  }

  /** Whether Make a plan starts in auto mode: the user's last choice, off until first made. */
  async autoMode(): Promise<boolean> {
    return this.settings.autoMode();
  }

  /**
   * The Planner says the Task is planned (mark_planned), refused with the reasons outside Planning
   * or before the Plan and the Definition of Done are written. With auto mode off nothing changes:
   * the user confirms. In auto mode, The Office accepts the Task and marks it Ready, unless a
   * Decision on it is open: the Planner waits for the answer and marks it planned again.
   */
  async markPlanned(taskId: string): Promise<MarkedPlanned> {
    const task = await this.tasks.find(taskId);
    if (!task) throw new TaskNotFound(taskId);
    refuseWith(markingPlannedProblems(task));
    if (!task.autoMode) return { outcome: "for-the-user" };
    const openDecisions = await this.decisions.openOn(taskId);
    if (openDecisions > 0) return { outcome: "waiting-for-a-decision", openDecisions };
    if (task.proposedPipeline) await this.refuseUnknownPipeline(task.proposedPipeline.pipelineId);
    const { task: ready, event } = await this.tasks.update(taskId, (latest) =>
      acceptInAutoMode(latest, openDecisions),
    );
    if (event) {
      for (const confirmation of event.confirmations) await this.events.publish(confirmation);
      await this.events.publish(event.stateChanged);
    }
    return { outcome: "ready", task: ready };
  }

  /** Backlog → Planning: the Task's branch and worktree, then its planning Thread. */
  private async startPlanning(
    taskId: string,
    plannerJoins: PlannerJoins,
    autoMode: boolean,
  ): Promise<Task> {
    const task = await this.tasks.find(taskId);
    if (!task) throw new TaskNotFound(taskId);
    if (task.state === "planning") return task;
    const problems = stateChangeProblems(task, "planning");
    if (problems.length > 0) throw new TaskRefused(problems);
    await this.refuseWithoutPlanner();
    // The worktree first: a Task whose worktree couldn't be made stays in Backlog.
    await this.worktrees.open(task.projectId, task.id).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The Task's worktree couldn't be made: ${reason}`]);
    });
    const { task: planning, event } = await this.tasks.update(taskId, (latest) => {
      // A Move landed as the worktree was made: it is in the old Project, not the Task's.
      if (latest.projectId !== task.projectId) throw new TaskRefused([MOVED_AS_IT_OPENED]);
      return startPlanningTask(latest, autoMode);
    });
    // Another call moved it first, and opened its Thread.
    if (!event) return planning;
    await this.events.publish(event);
    await this.openPlanningThread(taskId, plannerJoins, autoMode);
    return planning;
  }

  /**
   * The Task's planning Thread with the Planner; when it can't be opened, the move to Planning is
   * undone and refused with the reason, so a Task is never in Planning without its Thread.
   */
  private async openPlanningThread(
    taskId: string,
    plannerJoins: PlannerJoins,
    autoMode: boolean,
  ): Promise<void> {
    const opening = { taskId, roleKey: PLANNER, title: PLANNING_THREAD_TITLE };
    try {
      await (plannerJoins === "at-once"
        ? this.threads.startOnTask({ ...opening, opening: makeAPlanOpening(autoMode) })
        : this.threads.openOnTask(opening));
    } catch (error) {
      const { event } = await this.tasks.update(taskId, undoPlanningMove);
      if (event) await this.events.publish(event);
      const reason = error instanceof Error ? error.message : String(error);
      throw new TaskRefused([`The planning Thread couldn't be opened: ${reason}`]);
    }
  }

  /** Shapes the Idea into a Task in the Project and plans it at once. */
  async shapeAndPlan(ideaId: string, projectId: string, shapedBy: Author): Promise<Task> {
    await this.refuseWithoutPlanner();
    const task = await this.ideas.shape(ideaId, projectId, shapedBy);
    return this.plan(task.id);
  }

  async proposePlan(taskId: string, writing: PlanWriting): Promise<Task> {
    return this.update(taskId, (task) => proposePlan(task, writing));
  }

  /** The user's Plan: unconfirmed once changed, and a Ready Task goes back to Backlog. */
  async savePlan(taskId: string, writing: PlanWriting): Promise<Task> {
    return this.save(taskId, (task) => savePlan(task, writing));
  }

  /** The Plan, confirmed as it reads. */
  async confirmPlan(taskId: string): Promise<Task> {
    return this.update(taskId, confirmPlan);
  }

  async proposeDefinitionOfDone(taskId: string, statements: readonly string[]): Promise<Task> {
    return this.update(taskId, (task) => proposeDefinitionOfDone(task, statements));
  }

  /** The user's Definition of Done, under the Plan's rules. */
  async saveDefinitionOfDone(taskId: string, statements: readonly string[]): Promise<Task> {
    return this.save(taskId, (task) => saveDefinitionOfDone(task, statements));
  }

  /** The Definition of Done, confirmed as it reads. */
  async confirmDefinitionOfDone(taskId: string): Promise<Task> {
    return this.update(taskId, confirmDefinitionOfDone);
  }

  async proposePipeline(taskId: string, proposal: ProposedPipeline): Promise<Task> {
    await this.refuseUnknownPipeline(proposal.pipelineId);
    return this.update(taskId, (task) => proposePipeline(task, proposal));
  }

  /**
   * The user's Pipeline for the Task: the proposed one, or another from the library. The Task names
   * it by id only; Pipelines keeps a Task's own Stages, made when it starts or is edited for itself.
   */
  async confirmPipeline(taskId: string, pipelineId: string): Promise<Task> {
    await this.refuseUnknownPipeline(pipelineId);
    return this.update(taskId, (task) => confirmPipeline(task, pipelineId));
  }

  /**
   * Mark Ready, from Backlog or Planning: refused with the reasons until the Plan and Definition of Done are confirmed,
   * the Pipeline proposal is answered and no Decision on the Task is open.
   */
  async markReady(taskId: string): Promise<Task> {
    const openDecisions = await this.decisions.openOn(taskId);
    return this.update(taskId, (task) => markTaskReady(task, openDecisions));
  }

  /** The conditions of Mark Ready and which are met, for the checklist beside the button. */
  async readiness(taskId: string): Promise<ReadinessLine[]> {
    const task = await this.tasks.find(taskId);
    if (!task) throw new TaskNotFound(taskId);
    return readinessLines(task, await this.decisions.openOn(taskId));
  }

  private async update<Event extends DomainEvent>(
    taskId: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<Task> {
    const { task, event } = await this.tasks.update(taskId, change);
    if (event) await this.events.publish(event);
    return task;
  }

  /** As `update`, then the move back to Backlog a save made on a Ready Task. */
  private async save<Event extends TaskPlanSaved | TaskDefinitionOfDoneSaved>(
    taskId: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<Task> {
    const { task, event } = await this.tasks.update(taskId, change);
    if (event) await this.events.publish(event);
    if (event?.leftReady) await this.events.publish(event.leftReady);
    return task;
  }

  private async refuseUnknownPipeline(pipelineId: string): Promise<void> {
    if (await this.pipelines.find(pipelineId)) return;
    const known = (await this.pipelines.list()).map(({ id }) => id).join(", ");
    throw new TaskRefused([`There is no Pipeline "${pipelineId}". The library has ${known}.`]);
  }

  private async refuseWithoutPlanner(): Promise<void> {
    if (!(await this.people.find(PLANNER))) {
      throw new TaskRefused([
        "Hire a Planner on People first: planning is a conversation with them.",
      ]);
    }
  }
}

function refuseWith(problems: readonly string[]): void {
  if (problems.length > 0) throw new TaskRefused(problems);
}
