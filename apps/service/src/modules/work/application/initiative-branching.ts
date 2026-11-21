import type { Author } from "../domain/author.js";
import { Injectable, Logger } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { initiativeProjectIds, pipelineIn, type Initiative } from "../domain/initiative.js";
import {
  addBranch,
  backToShaping,
  backToShapingProblems,
  confirmInitiative,
  tasksByInitiative,
  type ConfirmBranching,
} from "../domain/initiative-changes.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { derivedShortName, initiativeBranchOf } from "../domain/short-name.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { taskPipelineProblems } from "../domain/pipeline-commands.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { ProjectInitiativeBranches } from "../ports/project-initiative-branches.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import type { Task } from "../domain/task.js";
import { TaskRepository } from "../ports/task-repository.js";
import { pipelineChoiceIn } from "./pipeline-choice.js";

/** A branch one attempt made, which it removes again if the attempt fails. */
interface MadeBranch {
  readonly projectId: string;
  readonly branch: string;
  readonly commit: string;
}

/**
 * The Initiative's branches (spec 5.5): made at Confirm in every Project it spans with a Pipeline,
 * and once active in such a Project its Tasks come back to, or one a Proposal gives its first
 * Pipeline; removed by Back to Shaping while they hold nothing beyond their base. Git runs before
 * the Initiative is held and never inside a hold: the hold then judges what was made, and anything
 * that fails removes the branches the same attempt made. One attempt at a time per Initiative.
 */
@Injectable()
export class InitiativeBranching {
  private readonly locks = new KeyedLocks();
  private readonly logger = new Logger(InitiativeBranching.name);

  constructor(
    private readonly repository: InitiativeRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly branches: ProjectInitiativeBranches,
    private readonly worktrees: ProjectWorktrees,
    private readonly events: EventBus,
  ) {}

  /**
   * Confirms the Initiative, making its branch first in every Project its Tasks span, those in
   * Shaping too, that has a Pipeline. Refused, naming the Project and why, when a branch can't
   * be made, with the branches made so far removed and the Initiative still shaping.
   */
  async confirm(id: string, by: Author): Promise<Initiative> {
    return this.locks.run(id, async () => {
      const initiative = await this.read(id);
      const projectIds = initiativeProjectIds(await this.tasksOf(id)).filter(
        (projectId) => pipelineIn(initiative, projectId) !== undefined,
      );
      const made = await this.makeForConfirm(initiative, projectIds);
      const branched: ConfirmBranching | undefined =
        initiative.shortName === undefined || projectIds.length === 0
          ? undefined
          : { shortName: initiative.shortName, projectIds, madeAt: new Date() };
      try {
        const confirmed = await this.repository.updateWithTasks(id, (held, tasks) =>
          confirmInitiative(held, tasks, branched, by),
        );
        if (confirmed.event) await this.events.publish(confirmed.event);
        for (const taskChange of confirmed.taskChanges) {
          await this.events.publish(taskChange.event);
        }
        return confirmed.initiative;
      } catch (error) {
        await this.removeAll(made);
        throw error;
      }
    });
  }

  /**
   * Back to Shaping (spec 2.1): judged first as the hold will judge it, then the Initiative's
   * branches are removed, locally and on the remote, each only while it holds nothing beyond its
   * base. Refused, naming the Project and why, when one can't be removed, with those removed so far
   * made again and the Initiative still active.
   */
  async backToShaping(id: string, by: Author): Promise<Initiative> {
    return this.locks.run(id, async () => {
      const initiative = await this.read(id);
      const tasks = await this.tasksOf(id);
      const withWorktree = await this.withWorktree(tasks);
      const problems = backToShapingProblems(initiative, tasks, withWorktree);
      if (problems.length > 0) throw new InitiativeRefused(problems);
      const removed = await this.removeForBackToShaping(initiative);
      try {
        const shaping = await this.repository.updateWithTasks(id, (held, heldTasks) =>
          backToShaping(held, heldTasks, withWorktree, removed, by),
        );
        if (shaping.event) await this.events.publish(shaping.event);
        for (const taskChange of shaping.taskChanges) {
          await this.events.publish(taskChange.event);
        }
        return shaping.initiative;
      } catch (error) {
        await this.makeAgain(initiative, removed);
        throw error;
      }
    });
  }

  /** The ids of those of `tasks` that have a worktree, read before any hold. */
  private async withWorktree(tasks: readonly Task[]): Promise<ReadonlySet<string>> {
    const opened = await readEach(tasks, async (task) =>
      (await this.worktrees.exists(task.projectId, task.id)) ? [task.id] : [],
    );
    return new Set(opened.flat());
  }

  /** The Projects whose branch it removed, all of the Initiative's, or refused with the first why. */
  private async removeForBackToShaping(initiative: Initiative): Promise<readonly string[]> {
    const { shortName } = initiative;
    if (shortName === undefined) return [];
    const branch = initiativeBranchOf(shortName);
    const removed: string[] = [];
    for (const { projectId } of initiative.branches) {
      const removal = await this.branches.removeEmpty(projectId, branch);
      if (removal.kind === "refused") {
        await this.makeAgain(initiative, removed);
        throw new InitiativeRefused([removal.reason]);
      }
      removed.push(projectId);
    }
    return removed;
  }

  /**
   * Makes again the branches a failed Back to Shaping removed, at the base as they held
   * nothing beyond it; one that can't be is only logged, so it doesn't hide why the attempt failed.
   */
  private async makeAgain(initiative: Initiative, projectIds: readonly string[]): Promise<void> {
    const { shortName } = initiative;
    if (shortName === undefined) return;
    const branch = initiativeBranchOf(shortName);
    for (const projectId of projectIds) {
      const making = await this.branches.make(projectId, branch).catch((error: unknown) => ({
        kind: "refused" as const,
        reason: error instanceof Error ? error.message : String(error),
      }));
      if (making.kind === "refused") {
        this.logger.warn(
          `The branch ${branch} removed from Project ${projectId} couldn't be made again: ${making.reason}`,
        );
      }
    }
  }

  /**
   * Before a Task of the Initiative is added to or moved into `projectId`, when the Initiative
   * doesn't span it yet. A Project new to it has None; one it spanned before keeps the Pipeline it
   * had there: then refused when the Project can no longer follow it, and once active, the
   * Initiative's branch is made there, or must still be there when its record says it was made.
   */
  async forNewProject(initiativeId: string, projectId: string): Promise<void> {
    await this.locks.run(initiativeId, async () => {
      const initiative = await this.read(initiativeId);
      const pipelineId = pipelineIn(initiative, projectId);
      if (pipelineId === undefined || (await this.spans(initiativeId, projectId))) return;
      const project = await this.project(projectId);
      await this.refusePipelineProblems(initiative, [project]);
      const { shortName } = initiative;
      if (initiative.state !== "active" || shortName === undefined) return;
      const branch = initiativeBranchOf(shortName);
      if (initiative.branches.some((made) => made.projectId === projectId)) {
        if (await this.branches.exists(projectId, branch)) return;
        throw new InitiativeRefused([
          `The Initiative's branch ${branch} is no longer in ${project.name}: The Office made it there and keeps it, so it won't make it again.`,
        ]);
      }
      const made = await this.make(projectId, branch);
      try {
        const { event } = await this.repository.update(initiativeId, (held) =>
          addBranch(held, projectId, new Date()),
        );
        if (event) await this.events.publish(event);
      } catch (error) {
        await this.removeAll([made]);
        throw error;
      }
    });
  }

  /**
   * Why a Task of the Initiative can't come into `projectId` as the Initiative's Pipeline there
   * stands: one the Project can no longer follow. None for a Project with None, and while the
   * Initiative spans it already.
   */
  async newProjectProblems(initiativeId: string, projectId: string): Promise<string[]> {
    const initiative = await this.read(initiativeId);
    if (
      pipelineIn(initiative, projectId) === undefined ||
      (await this.spans(initiativeId, projectId))
    )
      return [];
    const project = await this.projects.find(projectId);
    return project ? this.pipelineProblems(initiative, project) : [];
  }

  /**
   * Gives the Initiative's Pipeline in `projectId` by `choose`, and once it is active makes its
   * branch there first when the Project has none yet, named by the Short name it has or the one
   * its first Pipeline will derive: a branch that can't be made refuses the change.
   */
  async givingPipeline(
    initiativeId: string,
    projectId: string,
    choose: () => Promise<Initiative>,
  ): Promise<void> {
    await this.locks.run(initiativeId, async () => {
      const before = await this.read(initiativeId);
      const branched = before.branches.some((made) => made.projectId === projectId);
      if (before.state !== "active" || branched) {
        await choose();
        return;
      }
      const shortName = before.shortName ?? (await this.shortNameToDerive(initiativeId));
      const made = await this.make(projectId, initiativeBranchOf(shortName));
      try {
        const chosen = await choose();
        if (pipelineIn(chosen, projectId) === undefined) {
          await this.removeAll([made]);
          return;
        }
        if (chosen.shortName !== shortName) {
          throw new InitiativeRefused([
            `Another Initiative took the Short name ${shortName} meanwhile, so the branch made for it was removed; ask whoever shapes Initiatives to propose the Pipeline again.`,
          ]);
        }
        const { event } = await this.repository.update(initiativeId, (held) =>
          addBranch(held, projectId, new Date()),
        );
        if (event) await this.events.publish(event);
      } catch (error) {
        await this.removeAll([made]);
        throw error;
      }
    });
  }

  /** The Short name the Initiative's first Pipeline derives, as no other Initiative holds it now. */
  private async shortNameToDerive(initiativeId: string): Promise<string> {
    let derived: string | undefined;
    await this.repository.updateNaming(initiativeId, (held, taken) => {
      derived = derivedShortName(held.name, held.id, taken);
      return undefined;
    });
    if (derived === undefined) throw new InitiativeNotFound(initiativeId);
    return derived;
  }

  private async spans(initiativeId: string, projectId: string): Promise<boolean> {
    return (await this.tasksOf(initiativeId)).some((task) => task.projectId === projectId);
  }

  private async makeForConfirm(
    initiative: Initiative,
    projectIds: readonly string[],
  ): Promise<readonly MadeBranch[]> {
    const { shortName } = initiative;
    if (projectIds.length === 0 || shortName === undefined) return [];
    const projects = await readEach(projectIds, (projectId) => this.project(projectId));
    await this.refusePipelineProblems(initiative, projects);
    const branch = initiativeBranchOf(shortName);
    const made: MadeBranch[] = [];
    for (const { id } of projects) {
      try {
        made.push(await this.make(id, branch));
      } catch (error) {
        await this.removeAll(made);
        throw error;
      }
    }
    return made;
  }

  private async make(projectId: string, branch: string): Promise<MadeBranch> {
    const making = await this.branches.make(projectId, branch);
    if (making.kind === "refused") throw new InitiativeRefused([making.reason]);
    return { projectId, branch, commit: making.commit };
  }

  /**
   * Each branch on its own, so one that can't be removed (moved or deleted meanwhile) neither keeps
   * the others nor hides why the attempt failed; it is only logged.
   */
  private async removeAll(made: readonly MadeBranch[]): Promise<void> {
    for (const { projectId, branch, commit } of made) {
      try {
        await this.branches.remove(projectId, branch, commit);
      } catch (error) {
        this.logger.warn(
          `The branch ${branch} made in Project ${projectId} couldn't be removed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Refuses with every Project's reason it can't follow the Initiative's Pipeline there. */
  private async refusePipelineProblems(
    initiative: Initiative,
    projects: readonly KnownProject[],
  ): Promise<void> {
    const problems = await readEach(projects, (project) =>
      this.pipelineProblems(initiative, project),
    );
    if (problems.flat().length > 0) throw new InitiativeRefused(problems.flat());
  }

  /**
   * Why the Project can't follow the Initiative's Pipeline there, as a Task of it couldn't: gone
   * from the library, another Project's, Broken, or running a command it lacks.
   */
  private async pipelineProblems(initiative: Initiative, project: KnownProject): Promise<string[]> {
    const pipelineId = pipelineIn(initiative, project.id);
    if (pipelineId === undefined) return [];
    const choice = await pipelineChoiceIn(project.id, pipelineId, this.pipelines, this.projects);
    if (!choice.pipeline) {
      return [
        `The Initiative's Pipeline in ${project.name}, "${pipelineId}", is no longer in the library; choose another.`,
      ];
    }
    return taskPipelineProblems(choice, project);
  }

  private async project(projectId: string): Promise<KnownProject> {
    const project = await this.projects.find(projectId);
    if (!project) throw new InitiativeRefused([`There is no Project "${projectId}".`]);
    return project;
  }

  private async read(id: string): Promise<Initiative> {
    const initiative = await this.repository.find(id);
    if (!initiative) throw new InitiativeNotFound(id);
    return initiative;
  }

  private async tasksOf(id: string): Promise<readonly Task[]> {
    return tasksByInitiative(await this.tasks.inInitiatives([id])).get(id) ?? [];
  }
}
