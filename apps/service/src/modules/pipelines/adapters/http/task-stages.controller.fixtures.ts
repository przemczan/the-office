import type { ScriptStage } from "../../domain/stage.js";

export const tests: ScriptStage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
