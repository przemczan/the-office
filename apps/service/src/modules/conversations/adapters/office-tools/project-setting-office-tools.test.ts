import { describe, expect, it } from "vitest";
import {
  BY_NINA,
  SECRET_VALUE,
  SHOP,
  runOf,
  toolsWith,
  type Ruling,
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
  it("changes nothing and gives the reason at Never", async () => {
    const { tool, changes } = toolsWith("never");

    await expect(runOf(tool, EVERY_SECTION)).resolves.toEqual({
      text: "Your Role card says Never to Change Project settings.",
      isError: true,
    });
    expect(changes).toEqual([]);
  });

  it("applies every section at once when Allowed, in order, each recorded as the session's person on its Task, asked by the Thread's user", async () => {
    const { tool, changes, holds } = toolsWith("allowed");

    const result = await runOf(tool, EVERY_SECTION);

    expect(result).toEqual({
      text: "Changed: Shop's Environment variables, commands, test targets, Actions and Run environment (Off).",
      isError: false,
    });
    expect(holds).toHaveLength(1);
    expect(changes.map(({ method }) => method)).toEqual(IN_ORDER);
    for (const change of changes) expect(change.args.at(-1)).toEqual(BY_NINA);
  });

  it("holds the whole call as one approval at Ask me, then the same call applies every section once after Allow once", async () => {
    const { tool, changes, holds, allowOnce } = toolsWith("ask-me" satisfies Ruling);

    const held = await runOf(tool, EVERY_SECTION);
    expect(held).toMatchObject({ isError: false });
    expect(held.text).toContain("End your turn");
    expect(holds).toHaveLength(1);
    expect(changes).toEqual([]);

    allowOnce();
    await expect(runOf(tool, EVERY_SECTION)).resolves.toMatchObject({ isError: false });
    expect(changes.map(({ method }) => method)).toEqual(IN_ORDER);

    // The approval is spent: the same call waits again.
    expect((await runOf(tool, EVERY_SECTION)).text).toContain("End your turn");
    expect(changes).toHaveLength(IN_ORDER.length);
  });

  it("lists every change on the one approval card, by section", async () => {
    const { tool, holds } = toolsWith("ask-me");

    await runOf(tool, EVERY_SECTION);

    expect(holds[0]?.context).toBe(
      [
        "A lighter setup.",
        "",
        "It changes these settings of Shop as the Project page would, each recorded in its Recent activity:",
        "- Environment variables: plain variables become GREETING=hi; the Secret variables stay as they are",
        "- Install command: npm install",
        "- Test targets: removes web",
        "- Actions: removes build-app and its runs",
        "- Run environment: Off",
      ].join("\n"),
    );
  });

  it("never puts a Secret variable's value in the call, its approval or what it changes", async () => {
    const { tool, changes, holds } = toolsWith("allowed");

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

    expect(JSON.stringify(holds)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(changes)).not.toContain(SECRET_VALUE);
    expect(holds[0]?.context).toContain(
      "Test targets: changes web (Hosted, Secret variables by name: STRIPE_KEY)",
    );
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

    const result = await runOf(tool, {
      project: "shop",
      environmentVariables: { variables: [{ name: "API_TOKEN", value: "another-token" }] },
      runEnvironment: "off",
      why: "Rotated.",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("API_TOKEN");
    expect(result.text).not.toContain("another-token");
    expect(holds).toEqual([]);
    expect(changes).toEqual([]);
  });

  it.each([
    ["no section", {}],
    ["only empty sections", { testTargets: {}, actions: {}, environmentVariables: {} }],
  ])("refuses a call with %s, asking nobody", async (_, sections) => {
    const { tool, holds } = toolsWith("allowed");

    const result = await runOf(tool, { project: "shop", ...sections, why: "Nothing." });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Nothing to change/);
    expect(holds).toEqual([]);
  });

  it("refuses sections whose feature is switched off before anyone is asked, changing nothing", async () => {
    const { tool, changes, holds } = toolsWith("allowed", {
      project: { ...SHOP, features: { "test-targets": false, actions: false } },
    });

    const result = await runOf(tool, EVERY_SECTION);

    expect(result).toEqual({
      text: "Test targets are switched off for «Shop». Actions are switched off for «Shop».",
      isError: true,
    });
    expect(holds).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("stops at the first section refused, answering those applied and why", async () => {
    const { tool, changes } = toolsWith("allowed", { failingActions: true });

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
});
