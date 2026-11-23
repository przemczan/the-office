import type { KeptStage } from "./domain/routes-back.js";
import type { ScriptStage } from "./domain/stage.js";
import { anAgentStage } from "./pipelines-application.fixtures.js";

export const implement = anAgentStage("implement", { name: "Implement" });

/** Publish, going back to Implement once on failure as a previous release kept the setting. */
export const publish: KeptStage<ScriptStage> = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
  onFailure: { goBackTo: "implement", rounds: 1 },
};

export const reviewedPublish: KeptStage<ScriptStage> = { ...publish, afterConflict: "review" };

export const PULL_REQUEST = "https://github.com/notnullsoft/admin/pull/7";
