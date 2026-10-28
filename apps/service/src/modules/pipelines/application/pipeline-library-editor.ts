import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import {
  addedPipeline,
  copiedPipeline,
  pipelineEditFlags,
  pipelineEditProblems,
  pipelineUse,
  proposedEdit,
  proposedStagesProblems,
  removalProblems,
  savedPipeline,
  type PipelineEdit,
  type PipelineUse,
} from "../domain/library-pipeline.js";
import type { Pipeline, StageProblem } from "../domain/pipeline.js";
import type { Stage } from "../domain/stage.js";
import { PipelineRemoved } from "../domain/pipeline-library-events.js";
import { PipelineRemovalRefused, UnknownPipeline } from "../domain/pipeline-library-refusals.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectDefaults } from "../ports/project-defaults.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { RoleFillings } from "./role-fillings.js";

/** One key for the whole library: names are checked against every other Pipeline. */
const LIBRARY = "library";

/**
 * The library editor (spec §2.3): the user adds a Pipeline from scratch or as a copy, saves one, and
 * removes one nobody needs. Saving changes the Tasks that haven't started and follow it; a started
 * Task, or one edited for itself, keeps its own Stages.
 */
@Injectable()
export class PipelineLibraryEditor {
  private readonly changes = new KeyedLocks();

  constructor(
    private readonly repository: PipelineRepository,
    private readonly roleFillings: RoleFillings,
    private readonly projects: ProjectDefaults,
    private readonly tasks: StartedTasks,
    private readonly events: EventBus,
  ) {}

  async add(edit: PipelineEdit): Promise<Pipeline> {
    return this.changes.run(LIBRARY, async () => {
      await this.refuseProblems(edit, await this.repository.list());
      const { pipeline, event } = addedPipeline(randomUUID(), edit);
      await this.repository.add(pipeline);
      await this.events.publish(event);
      return pipeline;
    });
  }

  async copy(originalId: string): Promise<Pipeline> {
    return this.changes.run(LIBRARY, async () => {
      const library = await this.repository.list();
      const original = library.find(({ id }) => id === originalId);
      if (!original) throw new UnknownPipeline(originalId);
      const { pipeline, event } = copiedPipeline(randomUUID(), original, library);
      await this.repository.add(pipeline);
      await this.events.publish(event);
      return pipeline;
    });
  }

  async save(id: string, edit: PipelineEdit): Promise<Pipeline> {
    return this.changes.run(LIBRARY, async () => {
      const library = await this.repository.list();
      if (!library.some((pipeline) => pipeline.id === id)) throw new UnknownPipeline(id);
      await this.refuseProblems(edit, othersThan(id, library));
      return this.store(id, edit);
    });
  }

  /** Every reason a Proposal of the Pipeline's new Stages can't be saved now; it saves nothing. */
  async proposedStagesProblems(
    id: string,
    from: readonly Stage[],
    to: readonly Stage[],
  ): Promise<StageProblem[]> {
    const library = await this.repository.list();
    const pipeline = library.find((each) => each.id === id);
    if (!pipeline) return [{ text: new UnknownPipeline(id).message }];
    return proposedStagesProblems(pipeline, from, to, othersThan(id, library));
  }

  /**
   * Saves a Proposal's Stages (`to`) on the Pipeline, under its own name and description, as long
   * as its Stages are still those the Proposal was drafted from (`from`); refused otherwise.
   */
  async saveProposedStages(
    id: string,
    from: readonly Stage[],
    to: readonly Stage[],
  ): Promise<Pipeline> {
    return this.changes.run(LIBRARY, async () => {
      const library = await this.repository.list();
      const pipeline = library.find((each) => each.id === id);
      if (!pipeline) throw new UnknownPipeline(id);
      const problems = proposedStagesProblems(pipeline, from, to, othersThan(id, library));
      if (problems.length > 0) throw new StagesEditRefused(problems);
      return this.store(id, proposedEdit(pipeline, to));
    });
  }

  async remove(id: string): Promise<void> {
    await this.changes.run(LIBRARY, async () => {
      if (!(await this.repository.find(id))) throw new UnknownPipeline(id);
      const reasons = removalProblems(id, await this.use(id));
      if (reasons.length > 0) throw new PipelineRemovalRefused(reasons);
      await this.repository.remove(id);
      await this.events.publish(new PipelineRemoved(id));
    });
  }

  /** Who uses the Pipeline: the Projects naming it as their default, and Tasks not started or running. */
  async use(id: string): Promise<PipelineUse> {
    if (!(await this.repository.find(id))) throw new UnknownPipeline(id);
    const [projects, tasks] = await Promise.all([this.projects.list(), this.tasks.list()]);
    return pipelineUse(id, projects, tasks);
  }

  /**
   * What saving the edit would be refused for and what it would only flag; it saves nothing.
   * `pipelineId` is the Pipeline being saved, undefined for a new one.
   */
  async check(
    edit: PipelineEdit,
    pipelineId: string | undefined,
  ): Promise<{ readonly problems: StageProblem[]; readonly flags: StageProblem[] }> {
    const others = (await this.repository.list()).filter(({ id }) => id !== pipelineId);
    return {
      problems: pipelineEditProblems(edit, others),
      flags: pipelineEditFlags(edit, await this.roleFillings.of(edit.stages)),
    };
  }

  private async store(id: string, edit: PipelineEdit): Promise<Pipeline> {
    const { pipeline, event } = savedPipeline(id, edit);
    await this.repository.save(pipeline);
    await this.events.publish(event);
    return pipeline;
  }

  private async refuseProblems(edit: PipelineEdit, others: readonly Pipeline[]): Promise<void> {
    const problems = pipelineEditProblems(edit, others);
    if (problems.length > 0) throw new StagesEditRefused(problems);
  }
}

function othersThan(id: string, library: readonly Pipeline[]): readonly Pipeline[] {
  return library.filter((pipeline) => pipeline.id !== id);
}
