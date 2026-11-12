import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import {
  addedPipeline,
  copiedPipeline,
  missingCommandProblems,
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
import { agentStageRoles, newlyNamedRoles, type Stage } from "../domain/stage.js";
import { PipelineRemoved } from "../domain/pipeline-library-events.js";
import { PipelineRemovalRefused, UnknownPipeline } from "../domain/pipeline-library-refusals.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import { PipelineInitiatives } from "../ports/pipeline-initiatives.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectDefaults } from "../ports/project-defaults.js";
import { StageRoleEngines } from "../ports/stage-role-engines.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { RoleFillings } from "./role-fillings.js";

/** One key for the whole library: names are checked against every other Pipeline. */
const LIBRARY = "library";

/**
 * The library editor (spec §2.3): the user adds a Pipeline from scratch or as a copy, saves one, and
 * removes one nobody needs. Saving changes the Tasks that haven't started and follow it; a started
 * Task, or one edited for itself, keeps its own Stages. A save that newly names a Role whose engine
 * can't work an Agent Stage is refused (spec §5.4), and so is one naming a command a Project running
 * the Pipeline lacks (spec §2.3).
 */
@Injectable()
export class PipelineLibraryEditor {
  private readonly changes = new KeyedLocks();

  constructor(
    private readonly repository: PipelineRepository,
    private readonly roleFillings: RoleFillings,
    private readonly projects: ProjectDefaults,
    private readonly tasks: StartedTasks,
    private readonly roleEngines: StageRoleEngines,
    private readonly initiatives: PipelineInitiatives,
    private readonly events: EventBus,
  ) {}

  async add(edit: PipelineEdit): Promise<Pipeline> {
    return this.changes.run(LIBRARY, async () => {
      const library = await this.repository.list();
      await this.refuseProblems(undefined, edit, library, library);
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
      await this.refuseProblems(id, edit, othersThan(id, library), library);
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
    return this.proposalProblems(pipeline, from, to, library);
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
      const problems = await this.proposalProblems(pipeline, from, to, library);
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

  /**
   * Who uses the Pipeline: the Projects naming it as their default, Tasks not started or running,
   * and the shaping and active Initiatives naming it.
   */
  async use(id: string): Promise<PipelineUse> {
    if (!(await this.repository.find(id))) throw new UnknownPipeline(id);
    const [projects, tasks, initiatives] = await Promise.all([
      this.projects.list(),
      this.tasks.list(),
      this.initiatives.withPipelines(),
    ]);
    return pipelineUse(id, projects, tasks, initiatives);
  }

  /**
   * What saving the edit would be refused for and what it would only flag; it saves nothing.
   * `pipelineId` is the Pipeline being saved, undefined for a new one.
   */
  async check(
    edit: PipelineEdit,
    pipelineId: string | undefined,
  ): Promise<{ readonly problems: StageProblem[]; readonly flags: StageProblem[] }> {
    const library = await this.repository.list();
    const others = library.filter(({ id }) => id !== pipelineId);
    return {
      problems: [
        ...pipelineEditProblems(edit, others),
        ...(await this.roleEngineProblems(edit.stages, library)),
        ...(await this.missingCommandProblems(pipelineId, edit.stages)),
      ],
      flags: [
        ...pipelineEditFlags(edit, await this.roleFillings.of(edit.stages)),
        ...(await this.roleFillings.permissionProblems(edit.stages, 0)),
      ],
    };
  }

  private async store(id: string, edit: PipelineEdit): Promise<Pipeline> {
    const { pipeline, event } = savedPipeline(id, edit);
    await this.repository.save(pipeline);
    await this.events.publish(event);
    return pipeline;
  }

  private async refuseProblems(
    pipelineId: string | undefined,
    edit: PipelineEdit,
    others: readonly Pipeline[],
    library: readonly Pipeline[],
  ): Promise<void> {
    const problems = [
      ...pipelineEditProblems(edit, others),
      ...(await this.roleEngineProblems(edit.stages, library)),
      ...(await this.missingCommandProblems(pipelineId, edit.stages)),
    ];
    if (problems.length > 0) throw new StagesEditRefused(problems);
  }

  private async proposalProblems(
    pipeline: Pipeline,
    from: readonly Stage[],
    to: readonly Stage[],
    library: readonly Pipeline[],
  ): Promise<StageProblem[]> {
    return [
      ...proposedStagesProblems(pipeline, from, to, othersThan(pipeline.id, library)),
      ...(await this.roleEngineProblems(to, library)),
      ...(await this.missingCommandProblems(pipeline.id, to)),
    ];
  }

  /**
   * The commands the Stages name that a Project running the Pipeline lacks: one naming it as its
   * default, with a not-started Task on it, or spanned by a shaping or active Initiative naming it.
   * A new Pipeline has none of them.
   */
  private async missingCommandProblems(
    pipelineId: string | undefined,
    stages: readonly Stage[],
  ): Promise<StageProblem[]> {
    if (pipelineId === undefined) return [];
    const [projects, tasks, initiatives] = await Promise.all([
      this.projects.list(),
      this.tasks.list(),
      this.initiatives.withPipelines(),
    ]);
    return missingCommandProblems(pipelineId, stages, projects, tasks, initiatives);
  }

  /**
   * Only Roles the library doesn't name yet are weighed: those it names already passed the check on
   * every save of the engine cascade, so an old failure never blocks an unrelated save.
   */
  private async roleEngineProblems(
    stages: readonly Stage[],
    library: readonly Pipeline[],
  ): Promise<StageProblem[]> {
    const named = agentStageRoles(library.flatMap((pipeline) => pipeline.stages));
    const problems = await this.roleEngines.newlyNamedRolesProblems({
      roleKeys: newlyNamedRoles(agentStageRoles(stages), named),
      projectId: undefined,
    });
    return problems.map((text) => ({ text }));
  }
}

function othersThan(id: string, library: readonly Pipeline[]): readonly Pipeline[] {
  return library.filter((pipeline) => pipeline.id !== id);
}
