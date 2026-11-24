import { describe, expect, it } from "vitest";
import {
  CHANGE_ACTIONS_TOOL,
  CHANGE_ENVIRONMENT_VARIABLES_TOOL,
  CHANGE_PROJECT_COMMANDS_TOOL,
  CHANGE_RUN_ENVIRONMENT_TOOL,
  CHANGE_TEST_TARGETS_TOOL,
} from "../../domain/session-instructions.js";
import { BY_NINA, runOf, toolsWith } from "./project-setting-office-tools.fixtures.js";

const TEST_E2E = {
  key: "e2e",
  name: "End to end",
  kind: "test",
  commandLine: "npm run e2e",
  rerunCommandLine: "",
};

describe("the Project setting tools' calls", () => {
  it("read the same reworded only in key order or spacing, so the repeat finds its Allow once", async () => {
    const { tool, changes, allowOnce } = toolsWith("ask-me");

    await runOf(tool(CHANGE_PROJECT_COMMANDS_TOOL), {
      project: "shop",
      install: "npm   install ",
      commands: { add: [TEST_E2E], remove: ["build"] },
      why: "End-to-end tests.",
    });
    allowOnce();
    const result = await runOf(tool(CHANGE_PROJECT_COMMANDS_TOOL), {
      why: "End-to-end tests.",
      commands: {
        remove: ["build"],
        add: [
          {
            rerunCommandLine: "",
            commandLine: "npm run  e2e",
            kind: "test",
            name: "End to end",
            key: "e2e",
          },
        ],
      },
      install: "npm install",
      project: " shop ",
    });

    expect(result).toMatchObject({ isError: false });
    expect(changes).toHaveLength(1);
  });

  it("show the approver the Project and the setting, the input in one form", async () => {
    const { tool, holds } = toolsWith("ask-me");

    await runOf(tool(CHANGE_RUN_ENVIRONMENT_TOOL), {
      project: "shop",
      runEnvironment: "off",
      why: "No Docker here.",
    });

    expect(holds[0]).toMatchObject({
      switchKey: "changeProjectSettings",
      call: 'Change Run environment of the Project Shop to: {"runEnvironment":"off"}',
      why: "No Docker here.",
    });
    expect(holds[0]?.context).toMatch(/^No Docker here\./);
  });
});

describe("the change_project_commands tool", () => {
  it("changes install, its inputs and commands all or nothing, as a Proposal of them applies", async () => {
    const { tool, changes } = toolsWith("allowed");

    await runOf(tool(CHANGE_PROJECT_COMMANDS_TOOL), {
      project: "shop",
      install: "npm install",
      installInputs: [".nvmrc"],
      commands: {
        add: [TEST_E2E],
        change: [{ ...TEST_E2E, key: "test", name: "Unit" }],
        remove: ["build"],
      },
      why: "Tests.",
    });

    expect(changes).toEqual([
      {
        method: "changeCommandsAsProposed",
        args: [
          "shop",
          expect.objectContaining({
            installCommand: { from: "npm ci", to: "npm install" },
            installInputs: { from: ["package-lock.json"], to: [".nvmrc"] },
            commands: [
              expect.objectContaining({ key: "e2e", from: null }),
              expect.objectContaining({
                key: "test",
                to: expect.objectContaining({ name: "Unit" }),
              }),
              expect.objectContaining({ key: "build", to: null }),
            ],
          }),
          BY_NINA,
        ],
      },
    ]);
  });

  it.each(["beforePublishingCommand", "afterPublishingCommand"])(
    "refuses %s, pointing to propose_project_commands, asking nobody",
    async (line) => {
      const { tool, holds, changes } = toolsWith("allowed");

      const result = await runOf(tool(CHANGE_PROJECT_COMMANDS_TOOL), {
        project: "shop",
        [line]: "npm run release",
        why: "Ship it.",
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("propose_project_commands");
      expect(holds).toEqual([]);
      expect(changes).toEqual([]);
    },
  );

  it("refuses adding a command the Project has, and changing one it hasn't", async () => {
    const { tool, holds } = toolsWith("allowed");

    const result = await runOf(tool(CHANGE_PROJECT_COMMANDS_TOOL), {
      project: "shop",
      commands: { add: [{ ...TEST_E2E, key: "test" }], change: [TEST_E2E] },
      why: "Tests.",
    });

    expect(result).toEqual({
      text: 'The Project has a test command already: give it under change. The Project has no command with the key "e2e".',
      isError: true,
    });
    expect(holds).toEqual([]);
  });
});

describe("the change_run_environment tool", () => {
  it("is refused On, with the page's reasons, without a valid definition on the base branch", async () => {
    const { tool, changes } = toolsWith("allowed");

    await expect(
      runOf(tool(CHANGE_RUN_ENVIRONMENT_TOOL), {
        project: "shop",
        runEnvironment: "on",
        why: "Faster.",
      }),
    ).resolves.toEqual({
      text: "Run environment can't be On: the base branch main has no valid .devcontainer/. The repository has no .devcontainer/devcontainer.json.",
      isError: true,
    });
    expect(changes).toEqual([]);
  });

  it("turns On with a valid definition", async () => {
    const { tool, changes } = toolsWith("allowed", { definitionValid: true });

    await runOf(tool(CHANGE_RUN_ENVIRONMENT_TOOL), {
      project: "shop",
      runEnvironment: "on",
      why: "Faster.",
    });

    expect(changes).toEqual([{ method: "runEnvironments.change", args: ["shop", "on", BY_NINA] }]);
  });
});

describe("the change_test_targets tool", () => {
  it("adds a target after those kept, with no user marked as its setter", async () => {
    const { tool, changes } = toolsWith("allowed");

    await runOf(tool(CHANGE_TEST_TARGETS_TOOL), {
      project: "shop",
      targets: [
        {
          key: "android",
          name: "Android",
          kind: "build-to-install",
          entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
          outputPatterns: ["app/build/**/*.apk"],
        },
      ],
      why: "A phone build.",
    });

    const [change] = changes;
    expect(change?.method).toBe("testTargets.change");
    expect(((change?.args[1] ?? []) as Array<{ key: string }>).map(({ key }) => key)).toEqual([
      "web",
      "android",
    ]);
    expect(change?.args[2]).toBeNull();
  });

  it("refuses a target lacking its kind's own field, asking nobody", async () => {
    const { tool, holds } = toolsWith("allowed");

    const result = await runOf(tool(CHANGE_TEST_TARGETS_TOOL), {
      project: "shop",
      targets: [
        {
          key: "web",
          name: "Web",
          kind: "hosted",
          entryPoint: {
            kind: "package-script",
            manifest: "package.json",
            script: "dev",
            arguments: [],
          },
        },
      ],
      why: "Because.",
    });

    expect(result).toEqual({
      text: 'Test target "web" is Hosted, so it needs a port.',
      isError: true,
    });
    expect(holds).toEqual([]);
  });
});

describe("the change_actions tool", () => {
  const LINT = {
    key: "lint-all",
    name: "Lint everything",
    kind: "project-command",
    settings: { commandKey: "build" },
  };

  it("adds an Action after those kept, with no user marked as its setter", async () => {
    const { tool, changes } = toolsWith("allowed");

    await runOf(tool(CHANGE_ACTIONS_TOOL), { project: "shop", actions: [LINT], why: "Handy." });

    const [change] = changes;
    expect(((change?.args[1] ?? []) as Array<{ key: string }>).map(({ key }) => key)).toEqual([
      "build-app",
      "release",
      "lint-all",
    ]);
    expect(change?.args[2]).toBeNull();
    expect(change?.args[3]).toEqual(BY_NINA);
  });

  it.each([
    ["adding one marked", { actions: [{ ...LINT, leavesTheWorkstation: true }] }],
    [
      "adding a Workflow",
      {
        actions: [
          { key: "deploy", name: "Deploy", kind: "workflow", settings: { file: "deploy.yml" } },
        ],
      },
    ],
    ["marking one", { actions: [{ ...LINT, key: "build-app", leavesTheWorkstation: true }] }],
    [
      "changing one marked, or clearing its mark",
      {
        actions: [
          { key: "release", name: "Ship", kind: "workflow", settings: { file: "release.yml" } },
        ],
      },
    ],
    ["removing one marked", { removeActions: ["release"] }],
  ])("refuses %s, pointing to propose_actions, asking nobody", async (_, given) => {
    const { tool, holds, changes } = toolsWith("allowed");

    const result = await runOf(tool(CHANGE_ACTIONS_TOOL), {
      project: "shop",
      ...given,
      why: "Ship.",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("leave");
    expect(result.text).toContain("propose_actions");
    expect(holds).toEqual([]);
    expect(changes).toEqual([]);
  });
});

describe("the change_environment_variables tool", () => {
  it("keeps the lists left out, and refuses one marked secret", async () => {
    const { tool, changes } = toolsWith("allowed");

    await runOf(tool(CHANGE_ENVIRONMENT_VARIABLES_TOOL), {
      project: "shop",
      prependPath: ["/opt/node/bin"],
      why: "Node.",
    });
    const refused = await runOf(tool(CHANGE_ENVIRONMENT_VARIABLES_TOOL), {
      project: "shop",
      variables: [{ name: "NEW_TOKEN", value: "abcdefgh", secret: true }],
      why: "A token.",
    });

    expect(changes[0]?.args[1]).toEqual({
      set: [
        { name: "API_TOKEN", secret: true },
        { name: "GREETING", value: "hello", secret: false },
      ],
      unset: ["NODE_OPTIONS"],
      prependPath: ["/opt/node/bin"],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain("abcdefgh");
    expect(changes).toHaveLength(1);
  });
});

describe("every Project setting tool", () => {
  it.each([CHANGE_RUN_ENVIRONMENT_TOOL])("is refused outside a Thread on a Task", async (name) => {
    const { tool, holds } = toolsWith("allowed");

    const result = await runOf(
      tool(name),
      { project: "shop", runEnvironment: "off", why: "Because." },
      "another-session",
    );

    expect(result).toEqual({
      text: "A Project's settings change only from a Thread on a Task.",
      isError: true,
    });
    expect(holds).toEqual([]);
  });

  it("asks nobody about a Project that isn't there", async () => {
    const { tool, holds } = toolsWith("allowed");

    await expect(
      runOf(tool(CHANGE_RUN_ENVIRONMENT_TOOL), {
        project: "janitor",
        runEnvironment: "off",
        why: ".",
      }),
    ).resolves.toEqual({ text: 'The Office has no Project "janitor".', isError: true });
    expect(holds).toEqual([]);
  });
});
