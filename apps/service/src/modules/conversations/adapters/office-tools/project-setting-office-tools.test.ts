import { describe, expect, it } from "vitest";
import { aThread } from "../../domain/thread.fixtures.js";
import { ANN_LEE } from "../../domain/user.fixtures.js";
import {
  BY_NINA,
  SECRET_VALUE,
  SHOP,
  approvalLinesOf,
  checkOf,
  runOf,
  toolsWith,
} from "./project-setting-office-tools.fixtures.js";

/** One call changing every section the Agent may change. */
const EVERY_SECTION = {
  project: "shop",
  environmentVariables: { variables: [{ name: "GREETING", value: "hi" }] },
  install: "npm install",
  testTargets: { removeTargets: ["web"] },
  actions: { removeActions: ["build-app"] },
  runEnvironment: "off",
  why: "A lighter setup.",
};

/** The methods the sections apply through, in the order they apply. */
const IN_ORDER = [
  "changeEnvironment",
  "changeCommandsAsProposed",
  "testTargets.change",
  "actions.change",
  "runEnvironments.change",
];

describe("the change_project_settings tool", () => {
  it("applies every section at once, in order, each recorded as the session's person on its Task, asked by the Thread's user", async () => {
    const { tool, changes } = toolsWith();

    const result = await runOf(tool, EVERY_SECTION);

    expect(result).toEqual({
      text: "Changed: Shop's Environment variables, commands, test targets, Actions and Run environment (Off).",
      isError: false,
    });
    expect(changes.map(({ method }) => method)).toEqual(IN_ORDER);
    for (const change of changes) expect(change.args.at(-1)).toEqual(BY_NINA);
  });

  it("never puts a Secret variable's value in what it changes", async () => {
    const { tool, changes } = toolsWith();

    await runOf(tool, {
      project: "shop",
      environmentVariables: { variables: [{ name: "GREETING", value: "hi" }] },
      testTargets: {
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
      },
      why: "A clearer name.",
    });

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

  it("refuses a Secret variable", async () => {
    const { tool, changes } = toolsWith();

    const result = await runOf(tool, {
      project: "shop",
      environmentVariables: { variables: [{ name: "API_TOKEN", value: "another-token" }] },
      runEnvironment: "off",
      why: "Rotated.",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("API_TOKEN");
    expect(result.text).not.toContain("another-token");
    expect(changes).toEqual([]);
  });

  it.each([
    ["no section", {}],
    ["only empty sections", { testTargets: {}, actions: {}, environmentVariables: {} }],
  ])("refuses a call with %s", async (_, sections) => {
    const { tool } = toolsWith();

    const result = await runOf(tool, { project: "shop", ...sections, why: "Nothing." });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Nothing to change/);
  });

  it("refuses sections whose feature is switched off, changing nothing", async () => {
    const { tool, changes } = toolsWith({
      project: { ...SHOP, features: { "test-targets": false, actions: false } },
    });

    const result = await runOf(tool, EVERY_SECTION);

    expect(result).toEqual({
      text: "Test targets are switched off for «Shop». Actions are switched off for «Shop».",
      isError: true,
    });
    expect(changes).toEqual([]);
  });

  it("stops at the first section refused, answering those applied and why", async () => {
    const { tool, changes } = toolsWith({ failingActions: true });

    const result = await runOf(tool, {
      ...EVERY_SECTION,
      actions: {
        actions: [
          {
            key: "lint-all",
            name: "Lint everything",
            kind: "project-command",
            settings: { commandKey: "lint" },
          },
        ],
      },
    });

    expect(result).toEqual({
      text: 'Changed Shop\'s Environment variables, commands and test targets, each recorded in its Recent activity. Then the change of its Actions was refused: Action "lint-all" runs no command the Project has. Not changed after it: Run environment.',
      isError: true,
    });
    expect(changes.map(({ method }) => method)).toEqual(IN_ORDER.slice(0, 3));
  });

  it("works from a chat too, recorded as the person's with no Task, asked by the Thread's user", async () => {
    const chat = aThread({ roleKey: "devops", home: { kind: "chat", roleKey: "devops" } });
    const { tool, changes } = toolsWith({ thread: chat });

    const result = await runOf(tool, { project: "shop", runEnvironment: "off", why: "Lighter." });

    expect(result.isError).toBe(false);
    expect(changes.map(({ args }) => args.at(-1))).toEqual([{ ...BY_NINA, taskId: undefined }]);
  });

  it("records the user whose Allow once let a held call run, and nobody for an Allowed one", async () => {
    const held = toolsWith();
    const allowed = toolsWith();
    const call = { project: "shop", runEnvironment: "off", why: "Lighter." };

    await runOf(held.tool, call, undefined, ANN_LEE);
    await runOf(allowed.tool, call);

    expect(held.changes.map(({ args }) => args.at(-1))).toEqual([
      { ...BY_NINA, allowedBy: ANN_LEE },
    ]);
    expect(allowed.changes.map(({ args }) => args.at(-1))).toEqual([BY_NINA]);
  });

  describe("before the ruling step runs or holds a call", () => {
    it("refuses up front what it would refuse on running, changing nothing", async () => {
      const { tool, changes } = toolsWith({
        project: { ...SHOP, features: { "test-targets": false, actions: false } },
      });

      await expect(checkOf(tool, EVERY_SECTION)).resolves.toBe(
        "Test targets are switched off for «Shop». Actions are switched off for «Shop».",
      );
      await expect(checkOf(tool, { ...EVERY_SECTION, project: "nowhere" })).resolves.toBe(
        'The Office has no Project "nowhere".',
      );
      expect(changes).toEqual([]);
    });

    it("lets a call it can apply go on", async () => {
      const { tool } = toolsWith();

      await expect(checkOf(tool, EVERY_SECTION)).resolves.toBeUndefined();
    });

    it("lists every change on the approval card, naming Secret variables by name only", async () => {
      const { tool } = toolsWith();

      const lines = await approvalLinesOf(tool, {
        project: "shop",
        environmentVariables: { variables: [{ name: "GREETING", value: "hi" }] },
        commands: { change: [{ key: "test", name: "Test", kind: "test", commandLine: "vitest" }] },
        testTargets: {
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
        },
        runEnvironment: "on",
        why: "A clearer setup.",
      });

      expect(lines).toEqual([
        "Shop's Environment variables: plain variables become GREETING=hi; the Secret variables stay as they are",
        "Shop's Commands: changes test (vitest)",
        "Shop's Test targets: changes web (Hosted, Secret variables by name: STRIPE_KEY)",
        "Shop's Run environment: On",
      ]);
      expect(JSON.stringify(lines)).not.toContain(SECRET_VALUE);
    });
  });
});
