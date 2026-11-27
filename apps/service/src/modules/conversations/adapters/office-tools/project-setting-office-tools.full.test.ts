import { describe, expect, it } from "vitest";
import { BY_NINA, runOf, toolsWith } from "./project-setting-office-tools.fixtures.js";

const TEST_E2E = {
  key: "e2e",
  name: "End to end",
  kind: "test",
  commandLine: "npm run e2e",
  rerunCommandLine: "",
};

const WEB = {
  key: "web",
  name: "Web",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "dev", arguments: [] },
  port: 5173,
};

describe("the change_project_settings tool's refusals", () => {
  it("refuses every problem it can find up front at once, asking nobody", async () => {
    const { tool, changes } = toolsWith();

    const result = await runOf(tool, {
      project: "shop",
      commands: { change: [TEST_E2E] },
      testTargets: {
        targets: [
          {
            key: "web",
            name: "Web",
            kind: "hosted",
            entryPoint: { kind: "repository-file", path: "src/index.ts", arguments: [] },
          },
        ],
      },
      runEnvironment: "off",
      why: "Everything.",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('The Project has no command with the key "e2e".');
    expect(result.text).toContain('Test target "web" is Hosted, so it needs a port.');
    expect(changes).toEqual([]);
  });
});

describe("its install and commands", () => {
  it("changes install, its inputs and commands all or nothing, as a Proposal of them applies", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, {
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
        method: "changeCommands",
        args: [
          "shop",
          [
            { kind: "install", commandLine: "npm install" },
            { kind: "installInputs", inputs: [".nvmrc"] },
            { kind: "add", command: TEST_E2E },
            {
              kind: "change",
              key: "test",
              fields: expect.objectContaining({ name: "Unit" }),
            },
            { kind: "remove", key: "build" },
          ],
          BY_NINA,
        ],
      },
    ]);
  });

  it.each(["beforePublishingCommand", "afterPublishingCommand"])(
    "has no field %s, which is the action change_before_publishing_command's",
    async (line) => {
      const { tool, changes } = toolsWith();

      const result = await runOf(tool, {
        project: "shop",
        [line]: "npm run release",
        why: "Ship it.",
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/^Nothing to change/);
      expect(changes).toEqual([]);
    },
  );

  it("refuses adding a command the Project has, and changing one it hasn't", async () => {
    const { tool } = toolsWith();

    const result = await runOf(tool, {
      project: "shop",
      commands: { add: [{ ...TEST_E2E, key: "test" }], change: [TEST_E2E] },
      why: "Tests.",
    });

    expect(result).toEqual({
      text: 'The Project already has a command with the key "test". The Project has no command with the key "e2e".',
      isError: true,
    });
  });
});

describe("its Run environment", () => {
  it("turns On with nothing checked on the base branch", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, {
      project: "shop",
      runEnvironment: "on",
      why: "Faster.",
    });

    expect(changes).toEqual([{ method: "runEnvironments.change", args: ["shop", "on", BY_NINA] }]);
  });
});

describe("its test targets", () => {
  it("adds a target after those kept, with no user marked as its setter", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, {
      project: "shop",
      testTargets: {
        targets: [
          {
            key: "android",
            name: "Android",
            kind: "build-to-install",
            entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
            outputPatterns: ["app/build/**/*.apk"],
          },
        ],
      },
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
    const { tool } = toolsWith();

    const result = await runOf(tool, {
      project: "shop",
      testTargets: {
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
      },
      why: "Because.",
    });

    expect(result).toEqual({
      text: 'Test target "web" is Hosted, so it needs a port.',
      isError: true,
    });
  });
});

const groupsOf = async (given: unknown) => {
  const { tool } = toolsWith();
  return tool.authority?.groupsOf?.(
    tool.input.parse({ project: "shop", why: "x", ...(given as object) }),
  );
};

describe("its Actions", () => {
  const LINT = {
    key: "lint-all",
    name: "Lint everything",
    kind: "project-command",
    settings: { commandKey: "build" },
  };

  it("adds an Action after those kept, with no user marked as its setter", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, { project: "shop", actions: { actions: [LINT] }, why: "Handy." });

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
    ["marking one", { actions: [{ ...LINT, key: "build-app", leavesTheWorkstation: true }] }],
    ["removing one marked", { removeActions: ["release"] }],
  ])(
    "applies %s, an Action that leaves the workstation, recorded as the person's",
    async (_, given) => {
      const { tool, changes } = toolsWith();

      const result = await runOf(tool, { project: "shop", actions: given, why: "Ship." });

      expect(result.isError).toBe(false);
      expect(changes.map(({ method }) => method)).toEqual(["actions.change"]);
      expect(changes[0]?.args.at(-1)).toEqual(BY_NINA);
    },
  );

  it("marks an Action added as a Workflow as leaving the workstation, whatever was given", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, {
      project: "shop",
      actions: {
        actions: [
          { key: "deploy", name: "Deploy", kind: "workflow", settings: { file: "deploy.yml" } },
        ],
      },
      why: "Deploy.",
    });

    const kept = (changes[0]?.args[1] ?? []) as Array<{
      key: string;
      leavesTheWorkstation: boolean;
    }>;
    expect(kept.find(({ key }) => key === "deploy")?.leavesTheWorkstation).toBe(true);
  });

  describe("the Authority groups it touches", () => {
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
    ])("is Publishing settings for %s", async (_, given) => {
      await expect(groupsOf({ actions: given })).resolves.toEqual(["publishingSettings"]);
    });

    it.each([
      ["adding one that stays", { actions: [LINT] }],
      ["removing one that stays", { removeActions: ["build-app"] }],
    ])("is Change Project settings alone for %s", async (_, given) => {
      await expect(groupsOf({ actions: given })).resolves.toEqual([]);
    });

    it("adds Secret values for a Secret variable's value, an environment variable's or a test target's", async () => {
      await expect(
        groupsOf({
          environmentVariables: { variables: [{ name: "API_TOKEN", value: "new", secret: true }] },
        }),
      ).resolves.toEqual(["secretValues"]);
      await expect(
        groupsOf({
          testTargets: {
            targets: [{ ...WEB, secretVariables: [{ name: "STRIPE_KEY", value: "sk" }] }],
          },
        }),
      ).resolves.toEqual(["secretValues"]);
    });

    it("leaves Secret values out for a Secret variable kept without a value", async () => {
      await expect(
        groupsOf({ environmentVariables: { variables: [{ name: "API_TOKEN", secret: true }] } }),
      ).resolves.toEqual([]);
      await expect(
        groupsOf({
          testTargets: {
            targets: [{ ...WEB, secretVariables: [{ name: "STRIPE_KEY", value: "" }] }],
          },
        }),
      ).resolves.toEqual([]);
    });
  });
});

describe("its Environment variables", () => {
  it("keeps the lists left out", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, {
      project: "shop",
      environmentVariables: { prependPath: ["/opt/node/bin"] },
      why: "Node.",
    });

    expect(changes[0]?.args[1]).toEqual({
      set: [
        { name: "API_TOKEN", secret: true },
        { name: "GREETING", value: "hello", secret: false },
      ],
      unset: ["NODE_OPTIONS"],
      prependPath: ["/opt/node/bin"],
    });
  });

  it("sets a Secret variable's value, and keeps the value of one given without", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, {
      project: "shop",
      environmentVariables: {
        variables: [
          { name: "NEW_TOKEN", value: "abcdefgh", secret: true },
          { name: "API_TOKEN", secret: true },
          { name: "GREETING", value: "hi" },
        ],
      },
      why: "A token.",
    });

    expect(changes[0]?.args[1]).toMatchObject({
      set: [
        { name: "NEW_TOKEN", value: "abcdefgh", secret: true },
        { name: "API_TOKEN", secret: true },
        { name: "GREETING", value: "hi", secret: false },
      ],
    });
    expect(changes[0]?.args[1]).not.toHaveProperty("set.1.value");
  });

  it("refuses a plain value for a Secret variable's name, guiding to secret true", async () => {
    const { tool, changes } = toolsWith();

    const result = await runOf(tool, {
      project: "shop",
      environmentVariables: { variables: [{ name: "API_TOKEN", value: "another-token" }] },
      why: "Rotated.",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("API_TOKEN is a Secret variable");
    expect(result.text).not.toContain("another-token");
    expect(changes).toEqual([]);
  });
});

describe("the change_project_settings tool", () => {
  it("is refused to a session no Thread has", async () => {
    const { tool } = toolsWith();

    const result = await runOf(
      tool,
      { project: "shop", runEnvironment: "off", why: "Because." },
      "another-session",
    );

    expect(result).toEqual({
      text: "The Office doesn't know this session's Thread.",
      isError: true,
    });
  });

  it("asks nobody about a Project that isn't there", async () => {
    const { tool } = toolsWith();

    await expect(
      runOf(tool, {
        project: "janitor",
        runEnvironment: "off",
        why: ".",
      }),
    ).resolves.toEqual({ text: 'The Office has no Project "janitor".', isError: true });
  });
});
