import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { initiativeProjectIds, type Initiative } from "../domain/initiative.js";
import {
  addBranch,
  confirmInitiative,
  tasksByInitiative,
  type ConfirmBranching,
} from "../domain/initiative-changes.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { initiativePipelineProblems } from "../domain/initiative-pipeline.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { initiativeBranchOf } from "../domain/short-name.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { ProjectInitiativeBranches } from "../ports/project-initiative-branches.js";
import type { Task } from "../domain/task.js";
import { TaskRepository } from "../ports/task-repository.js";

/** A branch one attempt made, which it removes again if the attempt fails. */
interface MadeBranch {
  readonly projectId: string;
  readonly branch: string;
  readonly commit: string;
}

/**
 * The Initiative's branches (spec 5.5): made in every Project it spans at Confirm, and in a Project
 * it comes to span once active. Git runs before the Initiative is held and never inside a hold:
 * the hold then judges what was made, and anything that fails removes the branches the same
 * attempt made. One attempt at a time per Initiative.
 */
@Injectable()
export class InitiativeBranching {
  private readonly locks = new KeyedLocks();

  constructor(
    private readonly repository: InitiativeRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly branches: ProjectInitiativeBranches,
    private readonly events: EventBus,
  ) {}

  /**
   * Confirms the Initiative, making its branch first in every Project its Tasks span, those in
   * Shaping too, when it has a Pipeline. Refused, naming the Project and why, when a branch can't
   * be made, with the branches made so far removed and the Initiative still shaping.
   */
  async confirm(id: string): Promise<Initiative> {
    return this.locks.run(id, async () => {
      const initiative = await this.read(id);
      const projectIds = initiativeProjectIds(await this.tasksOf(id));
      const made = await this.makeForConfirm(initiative, projectIds);
      const branched: ConfirmBranching | undefined =
        initiative.shortName === undefined || initiative.pipelineId === undefined
          ? undefined
          : { shortName: initiative.shortName, projectIds, madeAt: new Date() };
      try {
        const confirmed = await this.repository.updateWithTasks(id, (held, tasks) =>
          confirmInitiative(held, tasks, branched),
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
   * Before a Task of the Initiative is added to or moved into `projectId`, when the Initiative
   * doesn't span it yet: with a Pipeline, refused when the Project lacks a command it runs; once
   * active, the Initiative's branch is made there, or must still be there when its record says it
   * was made.
   */
  async forNewProject(initiativeId: string, projectId: string): Promise<void> {
    await this.locks.run(initiativeId, async () => {
      const initiative = await this.read(initiativeId);
      if (initiative.pipelineId === undefined || (await this.spans(initiativeId, projectId)))
        return;
      const project = await this.project(projectId);
      await this.refuseMissingCommands(initiative.pipelineId, [project]);
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
   * Why a Task of the Initiative can't come into `projectId` as the Initiative's Pipeline stands:
   * a command it runs that the Project lacks. None while the Initiative spans it already.
   */
  async newProjectProblems(initiativeId: string, projectId: string): Promise<string[]> {
    const initiative = await this.read(initiativeId);
    if (initiative.pipelineId === undefined || (await this.spans(initiativeId, projectId)))
      return [];
    const project = await this.projects.find(projectId);
    const pipeline = await this.pipelines.commandsNamedBy(initiative.pipelineId);
    return project && pipeline ? initiativePipelineProblems(pipeline, [project]) : [];
  }

  private async spans(initiativeId: string, projectId: string): Promise<boolean> {
    return (await this.tasksOf(initiativeId)).some((task) => task.projectId === projectId);
  }

  private async makeForConfirm(
    initiative: Initiative,
    projectIds: readonly string[],
  ): Promise<readonly MadeBranch[]> {
    const { pipelineId, shortName } = initiative;
    if (pipelineId === undefined || shortName === undefined) return [];
    const projects = await Promise.all(projectIds.map((projectId) => this.project(projectId)));
    await this.refuseMissingCommands(pipelineId, projects);
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

  private async removeAll(made: readonly MadeBranch[]): Promise<void> {
    for (const { projectId, branch, commit } of made) {
      await this.branches.remove(projectId, branch, commit);
    }
  }

  private async refuseMissingCommands(
    pipelineId: string,
    projects: readonly KnownProject[],
  ): Promise<void> {
    const pipeline = await this.pipelines.commandsNamedBy(pipelineId);
    if (!pipeline) {
      throw new InitiativeRefused([
        `The Initiative's Pipeline "${pipelineId}" is no longer in the library; choose another.`,
      ]);
    }
    const problems = initiativePipelineProblems(pipeline, projects);
    if (problems.length > 0) throw new InitiativeRefused(problems);
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
    return tasksByInitiative(await this.tasks.list()).get(id) ?? [];
  }
}
