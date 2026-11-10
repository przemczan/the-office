import type { ScriptStage, ScriptStageCommand, Stage } from "../domain/stage.js";
import { aCommandRun } from "../ports/pipelines-ports.fixtures.js";

export function aScriptStage(
  command: ScriptStageCommand,
  fields: Partial<ScriptStage> = {},
): Stage {
  return { kind: "script", key: command, name: "Tests", optional: false, command, ...fields };
}

export const tests = aScriptStage("test");

export const passing = aCommandRun("npm test", "passed", "All 12 tests passed.");

export const failing = aCommandRun(
  "npm test",
  "failed",
  "FAIL renames a device: expected 'Hall' to be 'Kitchen'",
);
