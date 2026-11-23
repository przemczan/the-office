import type { StageRun } from "./stage-run.js";

/**
 * How a Publish Stage's run ended (spec §2.3.4, "Publish's results"). Published and Nothing to
 * publish are done; Conflict and After publishing failed are results of their own, neither done nor
 * failed; Failed shipped nothing for another reason.
 */
export type PublishResult =
  "published" | "nothing-to-publish" | "conflict" | "after-publishing-failed" | "failed";

/** Every Publish result, in the order the editor and the words list them. */
export const PUBLISH_RESULTS: readonly PublishResult[] = [
  "published",
  "nothing-to-publish",
  "conflict",
  "after-publishing-failed",
  "failed",
];

/** The results a Publish Stage ends done with, which its Otherwise takes. */
export const DONE_PUBLISH_RESULTS: ReadonlySet<PublishResult> = new Set([
  "published",
  "nothing-to-publish",
]);

/**
 * The result of a run of a Publish Stage; undefined while it runs or waits on a Decision. The one
 * place a run stored before results were kept is read: a done one as Published, a failed one by
 * the `baseMoved` and `afterPublishingFailed` it carries. Its stored status stays as it was, which
 * the previous release reads after a rollback.
 */
export function publishResultOf({ outcome }: Pick<StageRun, "outcome">): PublishResult | undefined {
  if (outcome === undefined || outcome.status === "needs-decision") return undefined;
  if (outcome.publishResult !== undefined) return outcome.publishResult;
  if (outcome.status === "done") return "published";
  if (outcome.baseMoved !== undefined) return "conflict";
  if (outcome.afterPublishingFailed !== undefined) return "after-publishing-failed";
  return "failed";
}

/** Each result as the UI and the words name it. */
export const PUBLISH_RESULT_NAMES: Readonly<Record<PublishResult, string>> = {
  published: "Published",
  "nothing-to-publish": "Nothing to publish",
  conflict: "Conflict",
  "after-publishing-failed": "After publishing failed",
  failed: "Failed",
};

/** Whether `outcome` is one of the results only a Publish Stage ends with. */
export function isPublishResultTest(outcome: string): outcome is Exclude<PublishResult, "failed"> {
  return outcome !== "failed" && (PUBLISH_RESULTS as readonly string[]).includes(outcome);
}
