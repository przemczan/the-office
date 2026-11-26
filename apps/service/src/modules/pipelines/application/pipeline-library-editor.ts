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
import { proposedEndPosition, withProposedPositions } from "../domain/flow.js";
import type { StagePosition } from "../domain/route.js";
import { ONBOARD_PIPELINE } from "../domain/built-in-pipelines.js";
import {
  asPipeline,
  copiedProjectPipeline,
  projectPipelineEditProblems,
  projectPipelineNameProblems,
  proposedProjectPipelineProblems,
  savedProjectPipeline,
  type NewProjectPipeline,
  type PipelinesAround,
  type ProjectPipeline,
  type ProjectPipelineEdit,
  type ProposedProjectPipeline,
} from "../domain/project-pipeline.js";
import {
  agentStageWorkers,
  newlyNamedWorkers,
  type Stage,
  type StageWorkers,
} from "../domain/stage.js";
import { PipelineRemoved } from "../domain/pipeline-library-events.js";
import { withLiveLinks } from "../domain/stage-template-link.js";
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
import { StageTemplateRepository } from "../ports/stage-template-repository.js";
import { StartedTasks, type StartedTask } from "../ports/started-tasks.js";
import { RoleFillings } from "./role-fillings.js";

/** One key for the whole library, Project Pipelines too: names are checked across both. */
const LIBRARY = "library";

/** What a check answers: what a save would be refused for, and what it only flags. */
export interface PipelineCheck {
  readonly problems: StageProblem[];
  readonly flags: StageProblem[];
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
 * lacks (spec §2.3). A Project Pipeline is a copy with its own Stages (spec §2.3.5, "Project
 * Pipelines"), so an office-wide Pipeline's save or removal never touches the Project Pipelines
 * copied from it.
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
    private readonly stageTemplates: StageTemplateRepository,
    private readonly events: EventBus,
  ) {}

  async add(edit: PipelineEdit): Promise<Pipeline> {
    return this.changes.run(LIBRARY, async () => {
      const library = await this.repository.list();
      await this.refuseProblems(undefined, edit, library, library);
      const { pipeline, event } = addedPipeline(randomUUID(), await this.withLiveLinks(edit));
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
   * as its Stages are still those the Proposal was drafted from (`from`); refused otherwise. Each
   * Stage it adds or moves, and End when it gives `endPosition`, stands where it puts them; every
   * other Stage where it stands now.
   */
  async saveProposedStages(
    id: string,
    from: readonly Stage[],
    to: readonly Stage[],
    endPosition?: StagePosition,
  ): Promise<Pipeline> {
    return this.changes.run(LIBRARY, async () => {
      const library = await this.repository.list();
      const pipeline = library.find((each) => each.id === id);
      if (!pipeline) throw new UnknownPipeline(id);
      const problems = await this.proposalProblems(pipeline, from, to, library);
      if (problems.length > 0) throw new StagesEditRefused(problems);
      return this.store(
        id,
        proposedEdit(
          pipeline,
          withProposedPositions(pipeline.stages, from, to),
          proposedEndPosition(pipeline.endPosition, undefined, endPosition),
        ),
      );
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
    const { projects, tasks, initiatives } = await this.runners([id]);
    return pipelineUse(id, projects, tasks, initiatives);
  }

  /**
   * What saving the edit would be refused for and what it would only flag; it saves nothing.
   * `pipelineId` is the Pipeline being saved, undefined for a new one.
   */
  async check(edit: PipelineEdit, pipelineId: string | undefined): Promise<PipelineCheck> {
    const library = await this.repository.list();
    return this.checkAgainst(edit, pipelineId, library, await this.projectPipelineNames());
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

  /**
   * Holds the library's lock through `work`, so nothing else adds, saves or removes a Pipeline
   * meanwhile; the move of the Project Pipelines at start runs under it.
   */
  async holdingLibrary<Result>(work: () => Promise<Result>): Promise<Result> {
    return this.changes.run(LIBRARY, work);
  }

  /**
   * Adds a Project Pipeline copied from `copyOf`'s Stages as they are: an office-wide Pipeline but
   * Onboard, or one of the Project's own. Only its name is checked; the editor flags the rest.
   */
  async addProjectPipeline(projectId: string, edit: NewProjectPipeline): Promise<ProjectPipeline> {
    return this.changes.run(LIBRARY, async () => {
      const source = await this.copySource(projectId, edit.copyOf);
      if (!source) throw new UnknownPipeline(edit.copyOf);
      const around = await this.around(undefined);
      const problems = await this.copyProblems(projectId, edit, around);
      if (problems.length > 0) throw new StagesEditRefused(problems);
      return this.addCopy(projectId, edit, source);
    });
  }

  /**
   * Saves the Project Pipeline's edit; its Project stays. A save ends its Broken before the update,
   * but one with `keepsBroken` (a template's edit applied to it, spec §2.3.5), which the user didn't
   * make in its editor.
   */
  async saveProjectPipeline(
    id: string,
    edit: ProjectPipelineEdit,
    { keepsBroken = false }: { readonly keepsBroken?: boolean } = {},
  ): Promise<ProjectPipeline> {
    return this.changes.run(LIBRARY, async () => {
      const saved = await this.projectPipelines.find(id);
      if (!saved) throw new UnknownProjectPipeline(id);
      const around = await this.around(id);
      const problems = await this.projectPipelineProblems(saved.projectId, edit, around, id);
      if (problems.length > 0) throw new StagesEditRefused(problems);
      return this.storeProjectPipeline(saved, edit, keepsBroken);
    });
  }

  /**
   * Every reason a Proposal of a Project Pipeline can't be applied now (see
   * `saveProposedProjectPipeline`); it saves nothing.
   */
  async proposedProjectPipelineProblems(
    proposal: ProposedProjectPipeline,
    copyOf?: string,
  ): Promise<StageProblem[]> {
    return (await this.proposalOutcome(proposal, copyOf)).problems;
  }

  /**
   * What applying a Proposal of a Project Pipeline would be refused for and what it would only
   * flag; it saves nothing.
   */
  async checkProposedProjectPipeline(
    proposal: ProposedProjectPipeline,
    copyOf?: string,
  ): Promise<PipelineCheck> {
    return {
      problems: (await this.proposalOutcome(proposal, copyOf)).problems,
      flags: await this.flagsOf(proposal.to.stages),
    };
  }

  /**
   * Applies a Proposal of a Project Pipeline, refused, changing nothing, while it has problems. A
   * new one (`pipelineId` null) is a copy of `copyOf` with the Proposal's whole flow, checked as a
   * save is. A change carries the whole flow and applies while the one it changes still has the
   * fields it was drafted from. Never sets the Project's default.
   */
  async saveProposedProjectPipeline(
    proposal: ProposedProjectPipeline,
    copyOf?: string,
  ): Promise<ProjectPipeline> {
    return this.changes.run(LIBRARY, async () => {
      const outcome = await this.proposalOutcome(proposal, copyOf);
      if (outcome.problems.length > 0) throw new StagesEditRefused(outcome.problems);
      if (outcome.saved) {
        return this.storeProjectPipeline(outcome.saved, appliedEdit(outcome.saved, proposal));
      }
      // Without problems, a new one always has its source.
      if (!outcome.source) throw new StagesEditRefused(outcome.problems);
      const { name, description, stages, endPosition } = proposal.to;
      return this.addCopy(
        proposal.projectId,
        { copyOf: outcome.source.id, name, description },
        outcome.source,
        { stages, ...(endPosition && { endPosition }) },
      );
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
    return pipelineUse(id, ownProject, tasks, initiatives);
  }

  /**
   * What saving the Project Pipeline's edit would be refused for and what it would only flag; it
   * saves nothing. Its Project stays.
   */
  async checkProjectPipeline(id: string, edit: ProjectPipelineEdit): Promise<PipelineCheck> {
    const saved = await this.projectPipelines.find(id);
    if (!saved) throw new UnknownProjectPipeline(id);
    return {
      problems: await this.projectPipelineProblems(
        saved.projectId,
        edit,
        await this.around(id),
        id,
      ),
      flags: await this.flagsOf(edit.stages),
    };
  }

  /**
   * The Project's own Pipelines that need fixing: Broken before The Office updated and not saved
   * since, or whose saved Stages their own check lists a problem or a flag for; all in one read.
   */
  async projectPipelinesNeedingFixing(projectId: string): Promise<string[]> {
    const needing = await Promise.all(
      (await this.projectPipelines.listOf(projectId)).map(async (projectPipeline) => {
        if (projectPipeline.brokenBeforeUpdate !== null) return [projectPipeline.id];
        const { problems, flags } = await this.checkProjectPipeline(
          projectPipeline.id,
          projectPipeline,
        );
        return problems.length + flags.length > 0 ? [projectPipeline.id] : [];
      }),
    );
    return needing.flat();
  }

  /**
   * What a Proposal would store, or why it can't be applied: the one it changes (`saved`), or for a
   * new one the Pipeline it copies (`source`).
   */
  private async proposalOutcome(
    proposal: ProposedProjectPipeline,
    copyOf: string | undefined,
  ): Promise<{
    readonly problems: StageProblem[];
    readonly saved?: ProjectPipeline;
    readonly source?: Pipeline;
  }> {
    const { projectId, pipelineId, to } = proposal;
    if (pipelineId !== null) {
      const saved = await this.projectPipelines.find(pipelineId);
      const problems = proposedProjectPipelineProblems(proposal, saved);
      if (!saved || problems.length > 0) return { problems };
      const around = await this.around(saved.id);
      return {
        problems: await this.projectPipelineProblems(projectId, to, around, saved.id),
        saved,
      };
    }
    if (copyOf === undefined) {
      return { problems: [pipelineProblem("Name the Pipeline the new Project Pipeline copies.")] };
    }
    const source = await this.copySource(projectId, copyOf);
    if (!source) return { problems: [pipelineProblem(new UnknownPipeline(copyOf).message)] };
    const around = await this.around(undefined);
    const problems = [
      ...copyOfProblems(copyOf),
      ...(await this.projectPipelineProblems(projectId, to, around, undefined)),
    ];
    return { problems, source };
  }

  /**
   * The Pipeline a Project Pipeline may be copied from: an office-wide one, or one of the Project's
   * own; undefined when there is none such, another Project's included.
   */
  async copySource(projectId: string, copyOf: string): Promise<Pipeline | undefined> {
    const officeWide = await this.repository.find(copyOf);
    if (officeWide) return officeWide;
    const projectPipeline = await this.projectPipelines.find(copyOf);
    return projectPipeline?.projectId === projectId ? asPipeline(projectPipeline) : undefined;
  }

  /**
   * Why the copy can't be added: Onboard stays as it is for onboarding, and the name must be the
   * copy's own. A copy's Stages are the source's as they are, so the rest only flags.
   */
  private async copyProblems(
    projectId: string,
    { copyOf, name }: NewProjectPipeline,
    around: PipelinesAround,
  ): Promise<StageProblem[]> {
    const onboard = copyOfProblems(copyOf);
    if (onboard.length > 0) return onboard;
    const project = (await this.projects.list()).find(({ id }) => id === projectId);
    if (!project) return [noProject(projectId)];
    return projectPipelineNameProblems(name, project, around);
  }

  private async addCopy(
    projectId: string,
    edit: NewProjectPipeline,
    source: Pipeline,
    flow?: Pick<Pipeline, "stages" | "endPosition">,
  ): Promise<ProjectPipeline> {
    const { projectPipeline, event } = copiedProjectPipeline(
      randomUUID(),
      projectId,
      edit,
      source,
      new Date(),
      flow && (await this.withLiveLinks(flow)),
    );
    await this.projectPipelines.add(projectPipeline);
    await this.events.publish(event);
    return projectPipeline;
  }

  private async storeProjectPipeline(
    saved: ProjectPipeline,
    edit: ProjectPipelineEdit,
    keepsBroken = false,
  ): Promise<ProjectPipeline> {
    const { projectPipeline, event } = savedProjectPipeline(saved, await this.withLiveLinks(edit), {
      keepsBroken,
    });
    await this.projectPipelines.save(projectPipeline);
    await this.events.publish(event);
    return projectPipeline;
  }

  private async store(id: string, edit: PipelineEdit): Promise<Pipeline> {
    const { pipeline, event } = savedPipeline(id, await this.withLiveLinks(edit));
    await this.repository.save(pipeline);
    await this.events.publish(event);
    return pipeline;
  }

  /**
   * The edit keeping only its Stages' links to a template that still exists and is of their kind
   * (spec §2.3.1): a link never refuses a save, it is dropped.
   */
  private async withLiveLinks<Edit extends { readonly stages: readonly Stage[] }>(
    edit: Edit,
  ): Promise<Edit> {
    if (!edit.stages.some(({ templateId }) => templateId !== undefined)) return edit;
    return { ...edit, stages: withLiveLinks(edit.stages, await this.stageTemplates.list()) };
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
        ...(await this.missingCommandProblems(pipelineId, edit.stages)),
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
      ...proposedStagesProblems(
        pipeline,
        from,
        to,
        othersThan(pipeline.id, library),
        await this.projectPipelineNames(),
      ),
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
    const { projects, tasks, initiatives } = await this.runners([pipelineId]);
    return missingCommandProblems(pipelineId, stages, projects, tasks, initiatives);
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

  /**
   * Every reason the Project's edited Pipeline can't be saved (`projectPipelineEditProblems`), the
   * engine check and missing commands, weighed against its own Project only. A new one has no
   * runners, so no missing commands.
   */
  private async projectPipelineProblems(
    projectId: string,
    edit: ProjectPipelineEdit,
    around: PipelinesAround,
    projectPipelineId: string | undefined,
  ): Promise<StageProblem[]> {
    const runners = await this.runners(projectPipelineId === undefined ? [] : [projectPipelineId]);
    const project = runners.projects.find(({ id }) => id === projectId);
    if (!project) return [noProject(projectId)];
    return [
      ...projectPipelineEditProblems(edit, project, around),
      ...(await this.projectRoleEngineProblems(edit.stages, project.id, around)),
      ...(projectPipelineId === undefined
        ? []
        : missingCommandProblems(
            projectPipelineId,
            edit.stages,
            [project],
            runners.tasks,
            runners.initiatives,
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
      ({ stages: own }) => own,
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

/** Onboard stays as it is, for onboarding: no Project copies it. */
function copyOfProblems(copyOf: string): StageProblem[] {
  return copyOf === ONBOARD_PIPELINE
    ? [pipelineProblem("The Onboard Pipeline can't be copied into a Project.")]
    : [];
}

function noProject(projectId: string): StageProblem {
  return pipelineProblem(`There is no Project "${projectId}".`);
}

function projectNameOf(projectId: string, projects: readonly ProjectDefault[]): string {
  return projects.find(({ id }) => id === projectId)?.name ?? projectId;
}

function othersThan(id: string | undefined, library: readonly Pipeline[]): readonly Pipeline[] {
  return library.filter((pipeline) => pipeline.id !== id);
}

/**
 * A Proposal's change of a Project Pipeline as applying it saves it on `saved`: each Stage it adds
 * or moves, and End when it moves it, where it puts them; every other Stage where it stands now.
 */
function appliedEdit(
  saved: ProjectPipeline,
  { from, to }: ProposedProjectPipeline,
): ProjectPipelineEdit {
  const endPosition = proposedEndPosition(saved.endPosition, from?.endPosition, to.endPosition);
  return {
    name: to.name,
    description: to.description,
    stages: withProposedPositions(saved.stages, from?.stages ?? saved.stages, to.stages),
    ...(endPosition && { endPosition }),
  };
}
