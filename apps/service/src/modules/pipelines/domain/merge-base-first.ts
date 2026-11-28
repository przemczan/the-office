import { promptTemplate, type PromptTexts } from "../../prompt-templates/index.domain.js";
import { RESOLVE_TEST_KEY } from "./publish-stages.js";
import type { Stage } from "./stage.js";
import type { StageRun } from "./stage-run.js";

/**
 * What the Agent of a Stage with Merge the base first is told when the merge left conflicts
 * (spec §2.3.1, "An Agent Stage may merge the base first"): the base and each conflicted file.
 */
export const RESOLVE_BRIEF = promptTemplate({
  key: "pipelines.resolve-brief",
  domain: "pipelines",
  name: "Resolve's Brief",
  description:
    "What the Agent of a Stage that merges the base first, such as Resolve, is told when the merge of the base branch into the Task's branch left conflicts.",
  variables: {
    baseBranch: { kind: "text", description: "The branch the Task publishes onto, such as main." },
    conflictedFiles: {
      kind: "list",
      description: "The files the merge left conflicts in, each read as {{.}}.",
    },
  },
  text: `The Task's branch conflicts with {{baseBranch}} as it now is, which other work moved on. The Office merged {{baseBranch}} into the branch and left the conflicts in these files:

{{#conflictedFiles}}
- {{.}}
{{/conflictedFiles}}

Edit each so it keeps what both sides meant, and remove every conflict marker (the <<<<<<<, ======= and >>>>>>> lines). Read the Task's Plan and what the base changed to judge it. Don't run git: The Office commits the merge once no marker is left, and the Pipeline goes on.

If you can't resolve a conflict, end the Stage failed and say why.`,
});

/**
 * What the Agent of a Stage with Merge the base first is told when the merge came in with no
 * conflict, which The Office committed at once (spec §2.3.1).
 */
export const MERGE_BASE_CLEAN = promptTemplate({
  key: "pipelines.merge-base-clean",
  domain: "pipelines",
  name: "Merge the base first: the base came in cleanly",
  description:
    "What the Agent of a Stage that merges the base first, such as Resolve, is told when the merge of the base branch into the Task's branch left no conflict.",
  variables: {
    baseBranch: {
      kind: "text",
      description: "What the branch took in, such as main, or initiative/x, then main.",
    },
  },
  text: "The Office merged {{baseBranch}} into the Task's branch as the Stage started, and it came in cleanly, with no conflict: the merge is committed already. Check that the Task's work and what the base changed still fit together, and fix what doesn't. Don't run git: The Office commits your changes.",
});

/** What Resolve's Agent is told when the Project's Test failed after the merge was committed. */
export const RESOLVE_AFTER_TEST = promptTemplate({
  key: "pipelines.resolve-after-test",
  domain: "pipelines",
  name: "Resolve's Brief after a failed Test",
  description:
    "What the Agent of a Stage that merges the base first, such as Resolve, is told when a Script Stage, such as the Project's Test, failed after The Office merged the base branch into the Task's branch.",
  variables: {},
  text: "The Project's Test failed after The Office merged the base branch into the Task's branch. Fix what the merge left broken, as the failure below shows, keeping what both sides meant. Don't run git: The Office commits your changes.",
});

/** What Resolve's Agent is told when the user sent the resolved conflict back from a Gate. */
export const RESOLVE_AFTER_GATE = promptTemplate({
  key: "pipelines.resolve-after-gate",
  domain: "pipelines",
  name: "Resolve's Brief after the user sent it back",
  description:
    "What the Agent of a Stage that merges the base first, such as Resolve, is told when the user reviewed how the conflict was resolved and sent it back with feedback.",
  variables: {},
  text: "The user reviewed how the conflict with the base branch was resolved and sent it back. The merge is committed already: change what their feedback below asks, keeping what both sides meant. Don't run git: The Office commits your changes.",
});

/** Every Prompt template a Stage with Merge the base first renders. */
export const MERGE_BASE_FIRST_TEMPLATES = [
  RESOLVE_BRIEF,
  MERGE_BASE_CLEAN,
  RESOLVE_AFTER_TEST,
  RESOLVE_AFTER_GATE,
] as const;

/** The section naming the base and each file its merge left conflicted, as `RESOLVE_BRIEF` words it. */
export function resolveBrief(
  prompts: PromptTexts,
  baseBranch: string,
  conflictedFiles: readonly string[],
): string {
  return prompts.render(RESOLVE_BRIEF, { baseBranch, conflictedFiles });
}

/**
 * Whether the user said they resolved the conflict in the worktree, answering a Decision on the run
 * just before this one, of the same Stage: The Office then only commits the merge.
 */
export function resolvedByTheUser(
  stage: Pick<Stage, "key">,
  earlierRuns: readonly StageRun[],
): boolean {
  const last = earlierRuns.at(-1);
  return (
    last?.stageKey === stage.key &&
    last.decisions.some(({ answer }) => answer?.kind === "resolved-in-worktree")
  );
}

/**
 * Why the walk brought the run back after the merge was committed, which picks its Brief: a Script
 * Stage's failure route, such as Test after Resolve's, or a Gate's Send back. Undefined for a run
 * that comes for a conflict, or anything else.
 */
export function broughtBackBy(
  run: Pick<StageRun, "carriedFailure" | "sentBack">,
  stages: readonly Stage[],
): "script-failure" | "send-back" | undefined {
  if (run.sentBack) return "send-back";
  const failed = run.carriedFailure?.stageKey;
  if (failed === undefined) return undefined;
  const kind = stages.find(({ key }) => key === failed)?.kind;
  // A Task that was in the conflict chain before it was the Pipeline's own: its Test's key.
  if (kind === "script" || failed.startsWith(RESOLVE_TEST_KEY)) return "script-failure";
  return undefined;
}
