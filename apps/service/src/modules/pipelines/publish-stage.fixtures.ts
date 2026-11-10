import type { ScriptStage } from "./domain/stage.js";
import { anAgentStage } from "./pipelines-application.fixtures.js";

export const implement = anAgentStage("implement", { name: "Implement" });

export const publish: ScriptStage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
  onFailure: { goBackTo: "implement", rounds: 1 },
};

export const reviewedPublish: ScriptStage = { ...publish, afterConflict: "review" };

export const PULL_REQUEST = "https://github.com/notnullsoft/admin/pull/7";
