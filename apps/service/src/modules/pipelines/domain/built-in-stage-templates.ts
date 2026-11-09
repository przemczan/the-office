import { builtInPipelines } from "./built-in-pipelines.js";
import { templateStage, type StageTemplate } from "./stage-template.js";

/**
 * The built-in Stages as templates (spec §2.3): the built-in Pipelines' Stages in the library's
 * order, the first of each name, each under its Stage's key. The `stage_templates` table's
 * migration seeds them once; from then on the library holds them and the user edits them like any.
 */
export const builtInStageTemplates: readonly StageTemplate[] = builtInPipelines
  .flatMap((pipeline) => pipeline.stages)
  .filter(
    (stage, index, stages) => stages.findIndex((other) => other.name === stage.name) === index,
  )
  .map((stage) => ({ id: stage.key, stage: templateStage(stage) }));
