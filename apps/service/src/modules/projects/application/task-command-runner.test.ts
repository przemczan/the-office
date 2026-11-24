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

function runnerWith(definitionCarried: boolean) {
  const runEnvironments = new ScriptedTaskRunEnvironments(new ShellCommandRunner());
  runEnvironments.definitionCarried = definitionCarried;
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  return taskCommandsOver(commands, git, runEnvironments.registry());
}

describe("TaskCommandRunner: where a Task's commands run", () => {
  it.each<[RunEnvironmentSetting, boolean, boolean]>([
    ["on", false, true],
    ["on", true, true],
    ["not-decided", true, true],
    ["not-decided", false, false],
    ["off", true, false],
    ["off", false, false],
  ])(
    "Run environment %s, with a definition carried %s: in the run environment %s",
    async (runEnvironment, carried, inRunEnvironment) => {
      const runner = runnerWith(carried);
      const project = aProject({ runEnvironment });

      expect(await runner.usesRunEnvironment(project, "/work/t")).toBe(inRunEnvironment);
      expect((await runner.placeOf(project, "t", "/work/t")).kind).toBe(
        inRunEnvironment ? "run-environment" : "host",
      );
      expect(await runner.runsInCarriedRunEnvironment(project, "/work/t")).toBe(
        runEnvironment === "not-decided" && carried,
      );
    },
  );
});
