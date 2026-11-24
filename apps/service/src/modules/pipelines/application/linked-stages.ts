import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Pipeline } from "../domain/pipeline.js";
import { PipelineSaved } from "../domain/pipeline-library-events.js";
import { UnknownStageTemplate } from "../domain/pipeline-library-refusals.js";
import type { ProjectPipeline } from "../domain/project-pipeline.js";
import type { Stage } from "../domain/stage.js";
import { unlinkedFrom, withTemplateFields } from "../domain/stage-template-link.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "../ports/project-pipeline-repository.js";
import { StageTemplateRepository } from "../ports/stage-template-repository.js";
import { PipelineLibraryEditor } from "./pipeline-library-editor.js";

/** A Stage linked to a template, with its Pipeline: office-wide (`projectId` null) or a Project's. */
export interface LinkedStage {
  readonly pipelineId: string;
  readonly pipelineName: string;
  readonly projectId: string | null;
  readonly stage: Stage;
}

/** A linked Stage by its Pipeline and its key. */
export interface LinkedStageRef {
  readonly pipelineId: string;
  readonly stageKey: string;
}

/** A Pipeline an apply refused, its Stages kept as they were. */
export interface RefusedPipeline {
  readonly pipelineId: string;
  readonly pipelineName: string;
  readonly projectId: string | null;
  readonly reasons: readonly string[];
}

/** What an apply did: how many Stages got the edit, and each Pipeline refused. */
export interface TemplateEditApplied {
  readonly applied: number;
  readonly refused: readonly RefusedPipeline[];
}

/** An office-wide or a Project Pipeline, as the links are read and written. */
type LibraryPipeline =
  | { readonly pipeline: Pipeline; readonly projectId: null }
  | { readonly pipeline: ProjectPipeline; readonly projectId: string };

/**
 * The Stages of office-wide and Project Pipelines linked to a Stage template (spec §2.3.1 and
 * §2.3.5, "Editing a template with linked Stages"): listing them, giving them a template edit the
 * user chose, each Pipeline saved as its editor saves it, and unlinking them as the template goes.
 * A Task's own Stages are never linked, so nothing here reaches them.
 */
@Injectable()
export class LinkedStages {
  constructor(
    private readonly pipelines: PipelineRepository,
    private readonly projectPipelines: ProjectPipelineRepository,
    private readonly templates: StageTemplateRepository,
    private readonly editor: PipelineLibraryEditor,
    private readonly events: EventBus,
  ) {}

  /** The Stages linked to the template: the office-wide Pipelines' first, then the Projects'. */
  async list(templateId: string): Promise<LinkedStage[]> {
    if (!(await this.templates.find(templateId))) throw new UnknownStageTemplate(templateId);
    return (await this.libraryPipelines()).flatMap(({ pipeline, projectId }) =>
      pipeline.stages
        .filter((stage) => stage.templateId === templateId)
        .map((stage) => ({
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          projectId,
          stage,
        })),
    );
  }

  /**
   * Sets the named template fields to the template's on each Stage named that is still linked to
   * it, its other fields kept, and saves each Pipeline through the editor, under its checks. A
   * refused Pipeline keeps its Stages and is named with why; the others are still applied. A
   * Project Pipeline Broken before the update stays Broken, as the user hasn't saved it.
   */
  async apply(
    templateId: string,
    fields: readonly string[],
    refs: readonly LinkedStageRef[],
  ): Promise<TemplateEditApplied> {
    const refused: RefusedPipeline[] = [];
    let applied = 0;
    for (const [pipelineId, stageKeys] of keysByPipeline(refs)) {
      const outcome = await this.editor.holdingLibrary(() =>
        this.applyTo(pipelineId, stageKeys, templateId, fields),
      );
      if ("refused" in outcome) refused.push(outcome.refused);
      else applied += outcome.applied;
    }
    return { applied, refused };
  }

  /**
   * Unlinks every Stage linked to the template, keeping its fields, as the template is removed: no
   * check, as the Stages change in nothing a Pipeline runs, and a Broken Project Pipeline stays so.
   */
  async unlinkAll(templateId: string): Promise<void> {
    await this.editor.holdingLibrary(async () => {
      for (const found of await this.libraryPipelines()) {
        const { pipeline } = found;
        if (!pipeline.stages.some((stage) => stage.templateId === templateId)) continue;
        const stages = unlinkedFrom(templateId, pipeline.stages);
        if (found.projectId === null) await this.pipelines.save({ ...found.pipeline, stages });
        else await this.projectPipelines.save({ ...found.pipeline, stages });
        await this.events.publish(new PipelineSaved(pipeline.id));
      }
    });
  }

  private async applyTo(
    pipelineId: string,
    stageKeys: ReadonlySet<string>,
    templateId: string,
    fields: readonly string[],
  ): Promise<{ readonly applied: number } | { readonly refused: RefusedPipeline }> {
    const template = await this.templates.find(templateId);
    if (!template) throw new UnknownStageTemplate(templateId);
    const found = await this.libraryPipeline(pipelineId);
    if (!found) return { applied: 0 };
    const { pipeline, projectId } = found;
    let applied = 0;
    const stages = pipeline.stages.map((stage) => {
      if (!stageKeys.has(stage.key) || stage.templateId !== templateId) return stage;
      applied += 1;
      return withTemplateFields(stage, template.stage, fields);
    });
    if (applied === 0) return { applied };
    const edit = { name: pipeline.name, description: pipeline.description, stages };
    try {
      if (projectId === null) await this.editor.save(pipeline.id, edit);
      // Only the user's own save ends a Project Pipeline's Broken before the update (spec §2.3.5).
      else await this.editor.saveProjectPipeline(pipeline.id, edit, { keepsBroken: true });
      return { applied };
    } catch (error) {
      if (!(error instanceof StagesEditRefused)) throw error;
      const reasons = error.problems.map(({ text }) => text);
      return {
        refused: { pipelineId, pipelineName: pipeline.name, projectId, reasons },
      };
    }
  }

  private async libraryPipeline(id: string): Promise<LibraryPipeline | undefined> {
    const officeWide = await this.pipelines.find(id);
    if (officeWide) return { pipeline: officeWide, projectId: null };
    const projectPipeline = await this.projectPipelines.find(id);
    return projectPipeline && { pipeline: projectPipeline, projectId: projectPipeline.projectId };
  }

  private async libraryPipelines(): Promise<LibraryPipeline[]> {
    const [officeWide, projectPipelines] = await Promise.all([
      this.pipelines.list(),
      this.projectPipelines.list(),
    ]);
    return [
      ...officeWide.map((pipeline): LibraryPipeline => ({ pipeline, projectId: null })),
      ...projectPipelines.map((pipeline): LibraryPipeline => ({
        pipeline,
        projectId: pipeline.projectId,
      })),
    ];
  }
}

function keysByPipeline(refs: readonly LinkedStageRef[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const { pipelineId, stageKey } of refs) {
    const keys = grouped.get(pipelineId) ?? new Set<string>();
    keys.add(stageKey);
    grouped.set(pipelineId, keys);
  }
  return grouped;
}
