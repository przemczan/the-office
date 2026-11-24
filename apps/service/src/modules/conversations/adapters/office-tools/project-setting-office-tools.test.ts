import { describe, expect, it } from "vitest";
import {
  CHANGE_ACTIONS_TOOL,
  CHANGE_ENVIRONMENT_VARIABLES_TOOL,
  CHANGE_PROJECT_COMMANDS_TOOL,
  CHANGE_RUN_ENVIRONMENT_TOOL,
  CHANGE_TEST_TARGETS_TOOL,
} from "../../domain/session-instructions.js";
import {
  BY_NINA,
  SECRET_VALUE,
  runOf,
  toolsWith,
  type Ruling,
} from "./project-setting-office-tools.fixtures.js";

/** One call of each tool that changes something the Agent may change. */
const CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  [CHANGE_RUN_ENVIRONMENT_TOOL, { project: "shop", runEnvironment: "off", why: "No Docker here." }],
  [
    CHANGE_PROJECT_COMMANDS_TOOL,
    { project: "shop", install: "npm install", why: "The lock file is gone." },
  ],
  [
    CHANGE_TEST_TARGETS_TOOL,
    { project: "shop", removeTargets: ["web"], why: "The web app moved out." },
  ],
  [CHANGE_ACTIONS_TOOL, { project: "shop", removeActions: ["build-app"], why: "Nobody runs it." }],
  [
    CHANGE_ENVIRONMENT_VARIABLES_TOOL,
    {
      project: "shop",
      variables: [{ name: "GREETING", value: "hi" }],
      why: "Shorter.",
    },
  ],
];

describe("the Project setting tools", () => {
  it.each(CALLS)("%s changes nothing and gives the reason at Never", async (name, input) => {
    const { tool, changes } = toolsWith("never");

    await expect(runOf(tool(name), input)).resolves.toEqual({
      text: "Your Role card says Never to Change Project settings.",
      isError: true,
    });
    expect(changes).toEqual([]);
  });

  it.each(CALLS)(
    "%s runs at once when Allowed, recorded as the session's person on its Task",
    async (name, input) => {
      const { tool, changes } = toolsWith("allowed");

      const result = await runOf(tool(name), input);

      expect(result).toMatchObject({ isError: false });
      expect(result.text).toMatch(/^Changed: /);
      expect(changes).toHaveLength(1);
      expect(changes[0]?.args.at(-1)).toEqual(BY_NINA);
    },
  );

  it.each(CALLS)(
    "%s waits on Ask me, then the same call runs once after Allow once",
    async (name, input) => {
      const { tool, changes, allowOnce } = toolsWith("ask-me" satisfies Ruling);

      const held = await runOf(tool(name), input);
      expect(held).toMatchObject({ isError: false });
      expect(held.text).toContain("End your turn");
      expect(changes).toEqual([]);

      allowOnce();
      await expect(runOf(tool(name), input)).resolves.toMatchObject({ isError: false });
      expect(changes).toHaveLength(1);

      // The approval is spent: the same call waits again.
      expect((await runOf(tool(name), input)).text).toContain("End your turn");
      expect(changes).toHaveLength(1);
    },
  );

  it("never puts a Secret variable's value in the call, its approval or what it changes", async () => {
    const { tool, changes, holds } = toolsWith("allowed");

    await runOf(tool(CHANGE_ENVIRONMENT_VARIABLES_TOOL), {
      project: "shop",
      variables: [{ name: "GREETING", value: "hi" }],
      why: "Shorter.",
    });
    await runOf(tool(CHANGE_TEST_TARGETS_TOOL), {
      project: "shop",
      targets: [
        {
          key: "web",
          name: "Web app",
          kind: "hosted",
          entryPoint: {
            kind: "package-script",
            manifest: "package.json",
            script: "dev",
            arguments: [],
          },
          port: 5173,
          secretVariables: ["STRIPE_KEY"],
        },
      ],
      why: "A clearer name.",
    });

    expect(JSON.stringify(holds)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(changes)).not.toContain(SECRET_VALUE);
    // Each Secret variable is sent by name alone, so Projects keeps its value.
    expect(changes[0]?.args[1]).toMatchObject({
      set: [
        { name: "API_TOKEN", secret: true },
        { name: "GREETING", value: "hi", secret: false },
      ],
    });
    expect(changes[1]?.args[1]).toMatchObject([{ secretVariables: [{ name: "STRIPE_KEY" }] }]);
  });

  it("refuses a Secret variable, asking nobody", async () => {
    const { tool, changes, holds } = toolsWith("allowed");

    const result = await runOf(tool(CHANGE_ENVIRONMENT_VARIABLES_TOOL), {
      project: "shop",
      variables: [{ name: "API_TOKEN", value: "another-token" }],
      why: "Rotated.",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("API_TOKEN");
    expect(result.text).not.toContain("another-token");
    expect(holds).toEqual([]);
    expect(changes).toEqual([]);
  });
});
