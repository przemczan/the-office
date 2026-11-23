import { builtInPipelines } from "./built-in-pipelines.js";
import { RESOLVE_KEY, RESOLVE_TEST_KEY } from "./publish-stages.js";
import {
  RESOLVE_TEMPLATE_BRIEF,
  RESOLVE_TEMPLATE_BUDGET,
  RESOLVE_TEMPLATE_ID,
  RESOLVE_TEMPLATE_NAME,
} from "./resolve-template.js";
import { templateStage, type StageTemplate } from "./stage-template.js";

/** The conflict chain's Stages, which the built-in Resolve template stands for (spec §2.3.4). */
const CONFLICT_CHAIN_KEYS: ReadonlySet<string> = new Set([RESOLVE_KEY, RESOLVE_TEST_KEY]);

/**
 * The built-in Resolve template (spec §2.3.4, "The Resolve Stage"), which the built-ins' Resolve
 * Stages are linked to; migration 0207 writes it.
 */
export const resolveStageTemplate: StageTemplate = {
  id: RESOLVE_TEMPLATE_ID,
  stage: {
    kind: "agent",
    key: RESOLVE_TEMPLATE_ID,
    name: RESOLVE_TEMPLATE_NAME,
    duty: "implements",
    brief: RESOLVE_TEMPLATE_BRIEF,
    session: "fresh",
    budget: RESOLVE_TEMPLATE_BUDGET,
    optional: false,
    mergeBaseFirst: true,
  },
};

/**
 * The built-in Stages as templates (spec §2.3), in the library's order: the built-in Pipelines'
 * Stages but the conflict chain's, the first of each name, each under the template it is linked to
 * or else its Stage's key, then the Resolve template. The `stage_templates` table's migrations seed
 * them once, the Resolve template last; from then on the library holds them and the user edits them
 * like any.
 */
export const builtInStageTemplates: readonly StageTemplate[] = [
  ...builtInPipelines
    .flatMap((pipeline) => pipeline.stages)
    .filter(({ key }) => !CONFLICT_CHAIN_KEYS.has(key))
    .filter(
      (stage, index, stages) => stages.findIndex((other) => other.name === stage.name) === index,
    )
    .map((stage) => ({ id: stage.templateId ?? stage.key, stage: templateStage(stage) })),
  resolveStageTemplate,
];
