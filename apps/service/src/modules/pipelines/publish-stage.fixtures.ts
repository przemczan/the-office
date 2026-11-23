import type { KeptStage } from "./domain/routes-back.js";
import type { KeptPublishStage } from "./domain/publish-stages.js";
import { anAgentStage } from "./pipelines-application.fixtures.js";

export const implement = anAgentStage("implement", { name: "Implement" });

/** Publish, going back to Implement once on failure as a previous release kept the setting. */
export const publish: KeptStage<KeptPublishStage> = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
  onFailure: { goBackTo: "implement", rounds: 1 },
};

export const reviewedPublish: KeptStage<KeptPublishStage> = { ...publish, afterConflict: "review" };

export const PULL_REQUEST = "https://github.com/notnullsoft/admin/pull/7";

/** Publish pushing the branch only, as a proof of concept's does. */
export const branchOnlyPublish: KeptStage<KeptPublishStage> = {
  ...publish,
  publishTarget: "branch-only",
};
