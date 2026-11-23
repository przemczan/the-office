import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { asWarnings, pipelineProblem, type StageProblem } from "../domain/pipeline.js";
import { UnknownStageTemplate } from "../domain/pipeline-library-refusals.js";
import type { Stage } from "../domain/stage.js";
import {
  addedStageTemplate,
  proposedStageProblems,
  savedStageTemplate,
  stageTemplateFlags,
  stageTemplateProblems,
  templateProblem,
  type StageTemplate,
} from "../domain/stage-template.js";
import { StageTemplateRemoved } from "../domain/stage-template-events.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import { StageTemplateRepository } from "../ports/stage-template-repository.js";
import { LinkedStages } from "./linked-stages.js";
import { RoleFillings } from "./role-fillings.js";

/** One key for all templates: a name is checked against every other template. */
const STAGE_TEMPLATES = "stage-templates";

/**
 * The Stage templates' editor (spec §2.3): the user adds a template, saves one and removes one,
 * which is never refused: its linked Stages are unlinked, keeping their fields. Its Role is
 * flagged like a library Pipeline's, but a template is no Pipeline: nothing runs from it, so its
 * Role counts for no engine check until it is added to a Pipeline or a Task.
 */
@Injectable()
export class StageTemplateLibraryEditor {
  private readonly changes = new KeyedLocks();

  constructor(
    private readonly repository: StageTemplateRepository,
    private readonly roleFillings: RoleFillings,
    private readonly linkedStages: LinkedStages,
    private readonly events: EventBus,
  ) {}

  async add(stage: Stage): Promise<StageTemplate> {
    return this.changes.run(STAGE_TEMPLATES, async () => {
      refuseProblems(stage, await this.repository.list());
      const { template, event } = addedStageTemplate(randomUUID(), stage);
      await this.repository.add(template);
      await this.events.publish(event);
      return template;
    });
  }

  async save(id: string, stage: Stage): Promise<StageTemplate> {
    return this.changes.run(STAGE_TEMPLATES, async () => {
      const templates = await this.repository.list();
      if (!templates.some((template) => template.id === id)) throw new UnknownStageTemplate(id);
      refuseProblems(stage, othersThan(id, templates));
      return this.store(id, stage);
    });
  }

  /** Every reason a Proposal of the template's new Stage can't be saved now; it saves nothing. */
  async proposedStageProblems(id: string, from: Stage, to: Stage): Promise<StageProblem[]> {
    const templates = await this.repository.list();
    const template = templates.find((each) => each.id === id);
    if (!template) return [pipelineProblem(new UnknownStageTemplate(id).message)];
    return proposedStageProblems(template, from, to, othersThan(id, templates));
  }

  /**
   * Saves a Proposal's Stage (`to`) on the template, as long as its Stage is still the one the
   * Proposal was drafted from (`from`); refused otherwise.
   */
  async saveProposedStage(id: string, from: Stage, to: Stage): Promise<StageTemplate> {
    return this.changes.run(STAGE_TEMPLATES, async () => {
      const templates = await this.repository.list();
      const template = templates.find((each) => each.id === id);
      if (!template) throw new UnknownStageTemplate(id);
      const problems = proposedStageProblems(template, from, to, othersThan(id, templates));
      if (problems.length > 0) throw new StagesEditRefused(problems);
      return this.store(id, to);
    });
  }

  async remove(id: string): Promise<void> {
    await this.changes.run(STAGE_TEMPLATES, async () => {
      if (!(await this.repository.find(id))) throw new UnknownStageTemplate(id);
      await this.repository.remove(id);
      await this.linkedStages.unlinkAll(id);
      await this.events.publish(new StageTemplateRemoved(id));
    });
  }

  /**
   * What saving the Stage as a template would be refused for and what it would only flag; it saves
   * nothing. `stageTemplateId` is the template being saved, undefined for a new one.
   */
  async check(
    stage: Stage,
    stageTemplateId: string | undefined,
  ): Promise<{ readonly problems: StageProblem[]; readonly flags: StageProblem[] }> {
    const others = othersThan(stageTemplateId, await this.repository.list());
    return {
      problems: stageTemplateProblems(stage, others),
      flags: asWarnings([
        ...stageTemplateFlags(stage, await this.roleFillings.of([stage])),
        ...(await this.roleFillings.stagePermissionProblems(stage)).map(templateProblem),
      ]),
    };
  }

  private async store(id: string, stage: Stage): Promise<StageTemplate> {
    const { template, event } = savedStageTemplate(id, stage);
    await this.repository.save(template);
    await this.events.publish(event);
    return template;
  }
}

function refuseProblems(stage: Stage, otherTemplates: readonly StageTemplate[]): void {
  const problems = stageTemplateProblems(stage, otherTemplates);
  if (problems.length > 0) throw new StagesEditRefused(problems);
}

function othersThan(
  id: string | undefined,
  templates: readonly StageTemplate[],
): readonly StageTemplate[] {
  return templates.filter((template) => template.id !== id);
}
