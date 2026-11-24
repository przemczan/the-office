import { describe, expect, it } from "vitest";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { RunEnvironmentSetting } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import type { Git } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";
import { ScriptedTaskRunEnvironments } from "./task-run-environments.fixtures.js";

const git = {
  repositoryGitFolderOf: () => Promise.resolve("/work/admin-panel/.git"),
} as unknown as Git;

function runnerWith(setUpTaskIds: readonly string[]) {
  const runEnvironments = new ScriptedTaskRunEnvironments(new ShellCommandRunner());
  for (const taskId of setUpTaskIds) runEnvironments.setUpTaskIds.add(taskId);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  return taskCommandsOver(commands, git, runEnvironments.registry());
}

describe("TaskCommandRunner: where a Task's commands run", () => {
  it.each<[RunEnvironmentSetting, boolean, boolean]>([
    ["on", false, true],
    ["on", true, true],
    ["off", false, false],
    // The Project's "Set up the run environment" Task runs in the one it sets up even while Off.
    ["off", true, true],
  ])(
    "Run environment %s, the Project's set-up Task %s: in the run environment %s",
    async (runEnvironment, setsUp, inRunEnvironment) => {
      const runner = runnerWith(setsUp ? ["t"] : []);
      const project = aProject({ runEnvironment });

      expect(await runner.usesRunEnvironment(project, "t")).toBe(inRunEnvironment);
      expect((await runner.placeOf(project, "t", "/work/t")).kind).toBe(
        inRunEnvironment ? "run-environment" : "host",
      );
    },
  );
});
