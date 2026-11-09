import { singleStageProblems, type StageProblem } from "./pipeline.js";
import type { Stage } from "./stage.js";
import { StageTemplateAdded, StageTemplateSaved } from "./stage-template-events.js";
import { stageStaffingProblem, type RoleFilling } from "./stage-staffing.js";

/**
 * A Stage kept in the Pipeline library to add to a Pipeline or a Task's Stages as a copy (spec
 * §2.3). Its name is its Stage's, unique in the library in any case.
 */
export interface StageTemplate {
  readonly id: string;
  readonly stage: Stage;
}

/**
 * The Stage as a template keeps it: its name trimmed and without a loop target, since "on failure
 * go back" names an earlier Stage, which only a Pipeline has.
 */
export function templateStage(stage: Stage): Stage {
  const name = stage.name.trim();
  if (stage.kind === "gate") return { ...stage, name };
  const { onFailure: _onFailure, ...rest } = stage;
  return { ...rest, name };
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
  return { text: problem.charAt(0).toUpperCase() + problem.slice(1) };
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
