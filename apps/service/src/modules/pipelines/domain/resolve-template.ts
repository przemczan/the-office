/**
 * The built-in Resolve Stage template (spec §2.3.4, "The Resolve Stage"): an Agent Stage with Merge
 * the base first on, which the conflict chain's Resolve Stages are linked to. Migration 0207 writes
 * the same into `stage_templates`.
 */
export const RESOLVE_TEMPLATE_ID = "resolve";

export const RESOLVE_TEMPLATE_NAME = "Resolve";

/** The template's budget: the largest built-in Agent Stage's, Implement's 370k, plus 250k. */
export const RESOLVE_TEMPLATE_BUDGET = 620_000;

/**
 * The tokens Resolve may use beyond the Pipeline's other Agent Stages, whose budgets count the whole
 * Task's tokens (spec §2.3.5, "The move to routes back and Publish Stages").
 */
export const RESOLVE_BUDGET_ABOVE = 250_000;

/** What Resolve's Agent is told beside the merge's own section (`pipelines.resolve-brief`). */
export const RESOLVE_TEMPLATE_BRIEF =
  "Resolve the conflicts the merge of the base left in the Task's branch. Edit each conflicted file so it keeps what both sides meant, read with the Task's Plan and what the base changed, and remove every conflict marker (the <<<<<<<, ======= and >>>>>>> lines). Edit files only and don't run git: The Office commits the merge as the Stage ends. If you can't resolve a conflict, end the Stage failed and say why.";
