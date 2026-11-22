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
import {
  asWarnings,
  pipelineProblem,
  stageWarnings,
  type Pipeline,
  type StageProblem,
} from "../domain/pipeline.js";
import type { TakenName } from "../domain/pipeline-names.js";
import {
  addedProjectPipeline,
  brokenBy,
  builtEdit,
  builtProjectPipeline,
  projectPipelineEditProblems,
  proposedProjectPipelineProblems,
  savedProjectPipeline,
  type BuiltProjectPipeline,
  type PipelinesAround,
  type ProjectPipeline,
  type ProjectPipelineEdit,
  type ProposedProjectPipeline,
} from "../domain/project-pipeline.js";
import { buildStages, type BrokenReason, type BuiltStages } from "../domain/stage-change.js";
import {
  agentStageWorkers,
  newlyNamedWorkers,
  type Stage,
  type StageWorkers,
} from "../domain/stage.js";
import { PipelineRemoved } from "../domain/pipeline-library-events.js";
import {
  PipelineRemovalRefused,
  UnknownPipeline,
  UnknownProjectPipeline,
} from "../domain/pipeline-library-refusals.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import { PipelineInitiatives, type PipelineInitiative } from "../ports/pipeline-initiatives.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectDefaults, type ProjectDefault } from "../ports/project-defaults.js";
import { ProjectPipelineRepository } from "../ports/project-pipeline-repository.js";
import { StageRoleEngines } from "../ports/stage-role-engines.js";
import { StartedTasks, type StartedTask } from "../ports/started-tasks.js";
import { RoleFillings } from "./role-fillings.js";

/** One key for the whole library, Project Pipelines too: names are checked across both. */
const LIBRARY = "library";

/** What a check answers: what a save would be refused for, and what it only flags. */
export interface PipelineCheck {
  readonly problems: StageProblem[];
  readonly flags: StageProblem[];
}

/** An office-wide Pipeline's check, with the Project Pipelines its edit would leave Broken. */
export interface OfficeWidePipelineCheck extends PipelineCheck {
  readonly breaks: readonly ProjectPipelineBreak[];
}

/** A Project Pipeline's check, with its Stages built from the edit; none without its base Pipeline. */
export interface ProjectPipelineCheck extends PipelineCheck {
  readonly built: BuiltStages | undefined;
}

/** A Project Pipeline an office-wide Pipeline's new Stages would leave Broken, with why. */
export interface ProjectPipelineBreak {
  readonly projectPipelineId: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly reasons: readonly BrokenReason[];
}

/**
 * Who runs which Pipeline: the Projects, Tasks and Initiatives the commands checks weigh; the Tasks
 * only those on the Pipelines weighed.
 */
interface PipelineRunners {
  readonly projects: readonly ProjectDefault[];
  readonly tasks: readonly StartedTask[];
  readonly initiatives: readonly PipelineInitiative[];
}

/**
 * The library editor (spec §2.3): the user adds an office-wide Pipeline from scratch or as a copy,
 * saves one, and removes one nobody needs, and does the same with a Project's own Pipelines.
 * Saving changes the Tasks that haven't started and follow it; a started Task, or one edited for
 * itself, keeps its own Stages. A save that newly names a Role whose engine can't work an Agent
 * Stage is refused (spec §5.4), and so is one naming a command a Project running the Pipeline
 * lacks (spec §2.3). An office-wide Pipeline's save may leave a Project Pipeline built from it
 * Broken, which its check warns of; a Project Pipeline's own save never does.
 */
@Injectable()
export class PipelineLibraryEditor {
  private readonly changes = new KeyedLocks();

  constructor(
    private readonly repository: PipelineRepository,
    private readonly projectPipelines: ProjectPipelineRepository,
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
      const { pipeline, event } = copiedPipeline(
        randomUUID(),
        original,
        library,
        await this.projectPipelines.list(),
      );
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
    if (!pipeline) return [pipelineProblem(new UnknownPipeline(id).message)];
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
   * the shaping and active Initiatives naming it, and the Project Pipelines built from it.
   */
  async use(id: string): Promise<PipelineUse> {
    if (!(await this.repository.find(id))) throw new UnknownPipeline(id);
    const [{ projects, tasks, initiatives }, builtFrom] = await Promise.all([
      this.runners([id]),
      this.projectPipelines.builtFrom(id),
    ]);
    return pipelineUse(id, projects, tasks, initiatives, builtFrom);
  }

  /**
   * What saving the edit would be refused for, what it would only flag, and the Project Pipelines
   * it would leave Broken, which never refuses it; it saves nothing. `pipelineId` is the Pipeline
   * being saved, undefined for a new one.
   */
  async check(
    edit: PipelineEdit,
    pipelineId: string | undefined,
  ): Promise<OfficeWidePipelineCheck> {
    const library = await this.repository.list();
    const saved = library.find(({ id }) => id === pipelineId);
    return {
      ...(await this.checkAgainst(edit, pipelineId, library, await this.projectPipelineNames())),
      breaks: saved ? await this.breaks(saved, { ...saved, ...edit }) : [],
    };
  }

  /**
   * The library Pipelines whose saved Stages their own check lists a problem or a flag for, all
   * checked in one go, the library and the names it may not take read once.
   */
  async needingFixing(): Promise<string[]> {
    const [library, takenNames] = await Promise.all([
      this.repository.list(),
      this.projectPipelineNames(),
    ]);
    const needing = await Promise.all(
      library.map(async (pipeline) => {
        const { problems, flags } = await this.checkAgainst(
          pipeline,
          pipeline.id,
          library,
          takenNames,
        );
        return problems.length + flags.length > 0 ? [pipeline.id] : [];
      }),
    );
    return needing.flat();
  }

  async addProjectPipeline(
    projectId: string,
    edit: ProjectPipelineEdit,
  ): Promise<BuiltProjectPipeline> {
    return this.changes.run(LIBRARY, async () => {
      const around = await this.around(undefined);
      const built = await this.refuseProjectPipelineProblems(projectId, edit, around, undefined);
      const { projectPipeline, event } = addedProjectPipeline(randomUUID(), projectId, edit, built);
      await this.projectPipelines.add(projectPipeline);
      await this.events.publish(event);
      return builtFromAround(projectPipeline, around);
    });
  }

  /** Saves the Project Pipeline's edit; its Project stays. */
  async saveProjectPipeline(id: string, edit: ProjectPipelineEdit): Promise<BuiltProjectPipeline> {
    return this.changes.run(LIBRARY, async () => {
      const saved = await this.projectPipelines.find(id);
      if (!saved) throw new UnknownProjectPipeline(id);
      const around = await this.around(id);
      const built = await this.refuseProjectPipelineProblems(saved.projectId, edit, around, id);
      const { projectPipeline, event } = savedProjectPipeline(saved, edit, built);
      await this.projectPipelines.save(projectPipeline);
      await this.events.publish(event);
      return builtFromAround(projectPipeline, around);
    });
  }

  /**
   * Every reason a Proposal of a Project Pipeline can't be applied now: the Project Pipeline it
   * changes is unknown, changed since or wouldn't change, or else what its add or save would be
   * refused for. It saves nothing.
   */
  async proposedProjectPipelineProblems(
    proposal: ProposedProjectPipeline,
  ): Promise<StageProblem[]> {
    const saved = await this.proposedOn(proposal);
    const problems = proposedProjectPipelineProblems(proposal, saved);
    if (problems.length > 0) return problems;
    return this.projectPipelineProblems(
      proposal.projectId,
      proposal.to,
      await this.around(saved?.id),
      saved?.id,
    );
  }

  /**
   * Adds the Proposal's new Project Pipeline, or saves its change whole, as long as the one it
   * changes still has the fields it was drafted from; refused, changing nothing, otherwise. Never
   * sets the Project's default.
   */
  async saveProposedProjectPipeline(
    proposal: ProposedProjectPipeline,
  ): Promise<BuiltProjectPipeline> {
    return this.changes.run(LIBRARY, async () => {
      const saved = await this.proposedOn(proposal);
      const problems = proposedProjectPipelineProblems(proposal, saved);
      if (problems.length > 0) throw new StagesEditRefused(problems);
      const around = await this.around(saved?.id);
      const { projectId, to } = proposal;
      const built = await this.refuseProjectPipelineProblems(projectId, to, around, saved?.id);
      const { projectPipeline, event } = saved
        ? savedProjectPipeline(saved, to, built)
        : addedProjectPipeline(randomUUID(), projectId, to, built);
      await (saved
        ? this.projectPipelines.save(projectPipeline)
        : this.projectPipelines.add(projectPipeline));
      await this.events.publish(event);
      return builtFromAround(projectPipeline, around);
    });
  }

  /** Refused while it is its Project's default or a Task that hasn't started uses it (spec §2.3). */
  async removeProjectPipeline(id: string): Promise<void> {
    await this.changes.run(LIBRARY, async () => {
      const reasons = removalProblems(id, await this.projectPipelineUse(id));
      if (reasons.length > 0) throw new PipelineRemovalRefused(reasons);
      await this.projectPipelines.remove(id);
      await this.events.publish(new PipelineRemoved(id));
    });
  }

  /** Who uses the Project Pipeline: its Project naming it as its default, and its Tasks. */
  async projectPipelineUse(id: string): Promise<PipelineUse> {
    const projectPipeline = await this.projectPipelines.find(id);
    if (!projectPipeline) throw new UnknownProjectPipeline(id);
    const { projects, tasks, initiatives } = await this.runners([id]);
    const ownProject = projects.filter(
      ({ id: projectId }) => projectId === projectPipeline.projectId,
    );
    return pipelineUse(id, ownProject, tasks, initiatives, []);
  }

  /**
   * What saving the Project Pipeline's edit would be refused for, what it would only flag, and its
   * Stages built from it; it saves nothing. `projectPipelineId` names the one being saved, whose
   * Project stays, and is undefined for a new one of `projectId`.
   */
  async checkProjectPipeline(
    edit: ProjectPipelineEdit,
    { projectId, projectPipelineId }: { projectId: string; projectPipelineId?: string },
  ): Promise<ProjectPipelineCheck> {
    let ownerId = projectId;
    if (projectPipelineId !== undefined) {
      const saved = await this.projectPipelines.find(projectPipelineId);
      if (!saved) throw new UnknownProjectPipeline(projectPipelineId);
      ownerId = saved.projectId;
    }
    const around = await this.around(projectPipelineId);
    const built = builtEdit(edit, around.officeWide);
    return {
      problems: await this.projectPipelineProblems(ownerId, edit, around, projectPipelineId),
      flags: built ? await this.flagsOf(built.stages) : [],
      built,
    };
  }

  /** The Project Pipeline a Proposal changes, as kept now; undefined for a new one or none. */
  private async proposedOn({
    pipelineId,
  }: ProposedProjectPipeline): Promise<ProjectPipeline | undefined> {
    return pipelineId === null ? undefined : this.projectPipelines.find(pipelineId);
  }

  private async store(id: string, edit: PipelineEdit): Promise<Pipeline> {
    const { pipeline, event } = savedPipeline(id, edit);
    await this.repository.save(pipeline);
    await this.events.publish(event);
    return pipeline;
  }

  private async checkAgainst(
    edit: PipelineEdit,
    pipelineId: string | undefined,
    library: readonly Pipeline[],
    takenNames: readonly TakenName[],
  ): Promise<PipelineCheck> {
    return {
      problems: [
        ...pipelineEditProblems(edit, othersThan(pipelineId, library), takenNames),
        ...(await this.roleEngineProblems(edit.stages, library)),
        ...(await this.missingCommandProblems(pipelineId, edit.name, edit.stages)),
      ],
      flags: await this.flagsOf(edit.stages),
    };
  }

  private async refuseProblems(
    pipelineId: string | undefined,
    edit: PipelineEdit,
    others: readonly Pipeline[],
    library: readonly Pipeline[],
  ): Promise<void> {
    const problems = [
      ...pipelineEditProblems(edit, others, await this.projectPipelineNames()),
      ...(await this.roleEngineProblems(edit.stages, library)),
      ...(await this.missingCommandProblems(pipelineId, edit.name, edit.stages)),
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
      ...proposedStagesProblems(
        pipeline,
        from,
        to,
        othersThan(pipeline.id, library),
        await this.projectPipelineNames(),
      ),
      ...(await this.roleEngineProblems(to, library)),
      ...(await this.missingCommandProblems(pipeline.id, pipeline.name, to)),
    ];
  }

  /**
   * The commands the Stages name that a Project running the Pipeline lacks: one naming it as its
   * default, with a not-started Task on it, or spanned by a shaping or active Initiative naming it;
   * and for each Project Pipeline built from it, built with these Stages, those its own Project
   * lacks while running it. A new Pipeline has none of them.
   */
  private async missingCommandProblems(
    pipelineId: string | undefined,
    name: string,
    stages: readonly Stage[],
  ): Promise<StageProblem[]> {
    if (pipelineId === undefined) return [];
    const builtFrom = await this.projectPipelines.builtFrom(pipelineId);
    const runners = await this.runners([pipelineId, ...builtFrom.map(({ id }) => id)]);
    const { projects, tasks, initiatives } = runners;
    return [
      ...missingCommandProblems(pipelineId, stages, projects, tasks, initiatives),
      ...builtFrom.flatMap((projectPipeline) => {
        const project = projects.find(({ id }) => id === projectPipeline.projectId);
        if (!project) return [];
        const built = buildStages({ name, stages }, projectPipeline.stageChanges);
        // Its Stages are the Project Pipeline's, not the edit's, so the problem sits on no Stage.
        return projectPipelineCommandProblems(projectPipeline, built.stages, project, runners).map(
          ({ text }) =>
            pipelineProblem(`${project.name}'s ${projectPipeline.name}, built from it: ${text}`),
        );
      }),
    ];
  }

  private async breaks(saved: Pipeline, edited: Pipeline): Promise<ProjectPipelineBreak[]> {
    const [builtFrom, projects] = await Promise.all([
      this.projectPipelines.builtFrom(saved.id),
      this.projects.list(),
    ]);
    return brokenBy(saved, edited, builtFrom).map(({ projectPipeline, reasons }) => ({
      projectPipelineId: projectPipeline.id,
      name: projectPipeline.name,
      projectId: projectPipeline.projectId,
      projectName: projectNameOf(projectPipeline.projectId, projects),
      reasons,
    }));
  }

  /** Every Project Pipeline's name, with its Project's: none an office-wide Pipeline may take. */
  private async projectPipelineNames(): Promise<TakenName[]> {
    const [projectPipelines, projects] = await Promise.all([
      this.projectPipelines.list(),
      this.projects.list(),
    ]);
    return projectPipelines.map(({ name, projectId }) => ({
      name,
      projectName: projectNameOf(projectId, projects),
    }));
  }

  private async refuseProjectPipelineProblems(
    projectId: string,
    edit: ProjectPipelineEdit,
    around: PipelinesAround,
    projectPipelineId: string | undefined,
  ): Promise<BuiltStages> {
    const problems = await this.projectPipelineProblems(projectId, edit, around, projectPipelineId);
    const built = builtEdit(edit, around.officeWide);
    if (problems.length > 0 || !built) throw new StagesEditRefused(problems);
    return built;
  }

  /**
   * Every reason the Project's edited Pipeline can't be saved (`projectPipelineEditProblems`), and
   * on its built Stages the engine check and missing commands, weighed against its own Project only.
   */
  private async projectPipelineProblems(
    projectId: string,
    edit: ProjectPipelineEdit,
    around: PipelinesAround,
    projectPipelineId: string | undefined,
  ): Promise<StageProblem[]> {
    const runners = await this.runners(projectPipelineId === undefined ? [] : [projectPipelineId]);
    const project = runners.projects.find(({ id }) => id === projectId);
    if (!project) return [pipelineProblem(`There is no Project "${projectId}".`)];
    const built = builtEdit(edit, around.officeWide);
    if (!built) return projectPipelineEditProblems(edit, project, around);
    return [
      ...projectPipelineEditProblems(edit, project, around),
      ...(await this.projectRoleEngineProblems(built.stages, project.id, around)),
      ...(projectPipelineId === undefined
        ? []
        : projectPipelineCommandProblems(
            { id: projectPipelineId, projectId },
            built.stages,
            project,
            runners,
          )),
    ];
  }

  /** The Pipelines around a Project Pipeline's edit, all but the one being saved. */
  private async around(projectPipelineId: string | undefined): Promise<PipelinesAround> {
    const [officeWide, projectPipelines] = await Promise.all([
      this.repository.list(),
      this.projectPipelines.list(),
    ]);
    return {
      officeWide,
      projectPipelines: projectPipelines.filter(({ id }) => id !== projectPipelineId),
    };
  }

  /** Who runs the Pipelines of these ids: every Project and Initiative, and the Tasks on them. */
  private async runners(pipelineIds: readonly string[]): Promise<PipelineRunners> {
    const [projects, tasks, initiatives] = await Promise.all([
      this.projects.list(),
      this.tasks.onPipelines(pipelineIds),
      this.initiatives.withPipelines(),
    ]);
    return { projects, tasks, initiatives };
  }

  /**
   * What the editor warns about but saves: Roles nobody fills, permissions wider than the card's,
   * and Stages whose routes all carry a condition.
   */
  private async flagsOf(stages: readonly Stage[]): Promise<StageProblem[]> {
    return [
      ...asWarnings([
        ...pipelineEditFlags(
          { name: "", description: "", stages },
          await this.roleFillings.of(stages),
        ),
        ...(await this.roleFillings.permissionProblems(stages, new Set())),
      ]),
      ...stageWarnings(stages),
    ];
  }

  /**
   * Only Roles the library doesn't name yet are weighed: those it names already passed the check on
   * every save of the engine cascade, so an old failure never blocks an unrelated save.
   */
  private async roleEngineProblems(
    stages: readonly Stage[],
    library: readonly Pipeline[],
  ): Promise<StageProblem[]> {
    const named = agentStageWorkers(library.flatMap((pipeline) => pipeline.stages));
    return this.engineProblems(stages, named, undefined);
  }

  /**
   * A Project Pipeline's Roles that neither the office-wide Pipelines nor its Project's Project
   * Pipelines, the one being saved as it was among them, name yet, weighed in its Project, the
   * only place its sessions run.
   */
  private async projectRoleEngineProblems(
    stages: readonly Stage[],
    projectId: string,
    around: PipelinesAround,
  ): Promise<StageProblem[]> {
    const projectStages = (await this.projectPipelines.listOf(projectId)).flatMap(
      (saved) => builtFromAround(saved, around).stages,
    );
    const named = agentStageWorkers([
      ...around.officeWide.flatMap((pipeline) => pipeline.stages),
      ...projectStages,
    ]);
    return this.engineProblems(stages, named, projectId);
  }

  private async engineProblems(
    stages: readonly Stage[],
    named: StageWorkers,
    projectId: string | undefined,
  ): Promise<StageProblem[]> {
    const problems = await this.roleEngines.newlyNamedRolesProblems({
      ...newlyNamedWorkers(agentStageWorkers(stages), named),
      projectId,
    });
    return problems.map(pipelineProblem);
  }
}

/** The commands a Project Pipeline's built Stages name that its own Project lacks while running it. */
function projectPipelineCommandProblems(
  projectPipeline: Pick<ProjectPipeline, "id" | "projectId">,
  stages: readonly Stage[],
  project: ProjectDefault,
  { tasks, initiatives }: PipelineRunners,
): StageProblem[] {
  return missingCommandProblems(projectPipeline.id, stages, [project], tasks, initiatives);
}

function builtFromAround(
  projectPipeline: ProjectPipeline,
  around: PipelinesAround,
): BuiltProjectPipeline {
  const base = around.officeWide.find(({ id }) => id === projectPipeline.basePipelineId);
  if (!base) throw new UnknownPipeline(projectPipeline.basePipelineId);
  return builtProjectPipeline(projectPipeline, base);
}

function projectNameOf(projectId: string, projects: readonly ProjectDefault[]): string {
  return projects.find(({ id }) => id === projectId)?.name ?? projectId;
}

function othersThan(id: string | undefined, library: readonly Pipeline[]): readonly Pipeline[] {
  return library.filter((pipeline) => pipeline.id !== id);
}
