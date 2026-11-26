import { asFlow } from "./flow.js";
import { pipelineProblem, singleStageProblems, type StageProblem } from "./pipeline.js";
import { sameAsKept, type Stage } from "./stage.js";
import { StageTemplateAdded, StageTemplateSaved } from "./stage-template-events.js";
import { stageStaffingProblem, type RoleFilling } from "./stage-staffing.js";

/**
 * A Stage kept in the Pipeline library to add to a Pipeline or a Task's Stages (spec §2.3); a
 * Pipeline's Stage added from it stays linked to it (spec §2.3.1). Its name is its Stage's, unique
 * in the library in any case.
 */
export interface StageTemplate {
  readonly id: string;
  readonly stage: Stage;
}

/**
 * The Stage as a template keeps it: its name trimmed and without routes, position, place or link,
 * since routes name other Stages and a position stands among them, which only a Pipeline has.
 */
export function templateStage(stage: Stage): Stage {
  const {
    routes: _routes,
    position: _position,
    place: _place,
    templateId: _templateId,
    ...unplaced
  } = stage;
  return { ...unplaced, name: stage.name.trim() };
}

/**
 * A template as the library reads it from storage, which is never rewritten: its Stage read by
 * `storedTemplateStage`.
 */
export function storedStageTemplate({ id, stage }: StageTemplate): StageTemplate {
  return { id, stage: storedTemplateStage(stage) };
}

/**
 * A template's Stage as kept, in storage or a Proposal: one kept before Publish was a kind of its
 * own (the built-in Publish template's Script Stage running `publish`) read as `asFlow` reads it, a
 * Publish Stage.
 */
export function storedTemplateStage(stage: Stage): Stage {
  const [read] = asFlow([stage]);
  return read ? templateStage(read) : stage;
}

/**
 * Every reason the Stage can't be kept as a template: it needs a name no other template has, and
 * the rules of a single Stage. Rules about neighbouring Stages wait until the template is added to
 * a Pipeline or a Task, whose editor checks them.
 */
export function stageTemplateProblems(
  stage: Stage,
  otherTemplates: readonly StageTemplate[],
): StageProblem[] {
  const kept = templateStage(stage);
  const named = comparableName(kept.name);
  const nameTaken =
    named !== "" && otherTemplates.some((other) => comparableName(other.stage.name) === named);
  return [
    ...(nameTaken ? [`another Stage template is named "${kept.name}".`] : []),
    ...singleStageProblems(kept),
  ].map(templateProblem);
}

/**
 * Every reason a Proposal of the template's new Stage (`to`) can't be saved on it now: its Stage
 * changed since the Proposal was drafted (`from`), nothing would change, or the new Stage breaks a
 * rule a template save keeps.
 */
export function proposedStageProblems(
  template: StageTemplate,
  from: Stage,
  to: Stage,
  otherTemplates: readonly StageTemplate[],
): StageProblem[] {
  if (!sameAsKept(template.stage, from)) {
    return [
      pipelineProblem(`The ${template.stage.name} Stage template changed since this was proposed.`),
    ];
  }
  if (sameAsKept(from, templateStage(to))) {
    return [pipelineProblem("Nothing changes: give the template's Stage as it should be, whole.")];
  }
  return stageTemplateProblems(to, otherTemplates);
}

/** What the editor flags but saves: an Agent Stage whose Role nobody can work. */
export function stageTemplateFlags(
  stage: Stage,
  roles: ReadonlyMap<string, RoleFilling>,
): StageProblem[] {
  const problem = stageStaffingProblem(stage, roles);
  return problem ? [templateProblem(problem)] : [];
}

/**
 * A template's problem, on no Stage index: the template is its one Stage. The words are a Stage's
 * problem's, as a sentence of their own.
 */
export function templateProblem(problem: string): StageProblem {
  return pipelineProblem(problem.charAt(0).toUpperCase() + problem.slice(1));
}

/** A template made from scratch or from a Stage, which `stageTemplateProblems` allowed. */
export function addedStageTemplate(
  id: string,
  stage: Stage,
): { readonly template: StageTemplate; readonly event: StageTemplateAdded } {
  return { template: { id, stage: templateStage(stage) }, event: new StageTemplateAdded(id) };
}

/** A template as the user saved it, which `stageTemplateProblems` allowed. */
export function savedStageTemplate(
  id: string,
  stage: Stage,
): { readonly template: StageTemplate; readonly event: StageTemplateSaved } {
  return { template: { id, stage: templateStage(stage) }, event: new StageTemplateSaved(id) };
}

function comparableName(name: string): string {
  return name.trim().toLowerCase();
}
