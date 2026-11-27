import { describe, expect, it } from "vitest";
import type { OfficeToolApplication } from "../../../engine/index.js";
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

const NEW_SECRET = "n3w-secret-value";

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
  "changeCommands",
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
            secretVariables: [{ name: "STRIPE_KEY" }],
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
              secretVariables: [{ name: "STRIPE_KEY" }],
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

describe("the change_project_settings tool with Secret values", () => {
  const GIVEN = {
    project: "shop",
    environmentVariables: {
      variables: [
        { name: "GREETING", value: "hi" },
        { name: "API_TOKEN", value: NEW_SECRET, secret: true },
      ],
    },
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
          port: 5173,
          secretVariables: [{ name: "STRIPE_KEY", value: NEW_SECRET }],
        },
      ],
    },
    actions: { removeActions: ["release"] },
    runEnvironment: "on",
    why: "Rotate the keys.",
  };

  it("sets the values given, sending a Secret variable's value to Projects only as a value", async () => {
    const { tool, changes } = toolsWith();

    const result = await runOf(tool, GIVEN);

    expect(result.isError).toBe(false);
    expect(changes[0]?.args[1]).toMatchObject({
      set: [{ name: "API_TOKEN", secret: true, value: NEW_SECRET }, { name: "GREETING" }],
    });
    expect(changes[1]?.args[1]).toMatchObject([
      { secretVariables: [{ name: "STRIPE_KEY", value: NEW_SECRET }] },
    ]);
  });

  it("is ruled by Publishing settings and Secret values besides Change Project settings", async () => {
    const { tool } = toolsWith();

    await expect(tool.authority?.groupsOf?.(tool.input.parse(GIVEN))).resolves.toEqual([
      "publishingSettings",
      "secretValues",
    ]);
    expect(tool.authority?.group).toBe("changeProjectSettings");
  });

  it("redacts each Secret value, keeping its name and the call valid", async () => {
    const { tool } = toolsWith();
    const given = tool.input.parse(GIVEN);

    const redacted = await tool.redact?.(given);

    expect(JSON.stringify(redacted)).not.toContain(NEW_SECRET);
    expect(redacted?.hasSecret).toBe(true);
    expect(redacted?.shown).toMatchObject({
      environmentVariables: {
        variables: [
          { name: "GREETING", value: "hi" },
          { name: "API_TOKEN", value: "", secret: true },
        ],
      },
      testTargets: { targets: [{ secretVariables: [{ name: "STRIPE_KEY" }] }] },
    });
    expect(() => tool.input.parse(redacted?.shown)).not.toThrow();
    await expect(
      tool.redact?.(
        tool.input.parse({ ...GIVEN, testTargets: undefined, environmentVariables: undefined }),
      ),
    ).resolves.toMatchObject({ hasSecret: false });
  });

  it("names each approval line's Secret value by name only", async () => {
    const { tool } = toolsWith();

    const lines = await approvalLinesOf(tool, GIVEN);

    expect(lines).toContain(
      "Shop's Environment variables: plain variables become GREETING=hi; Secret variables set, by name only: API_TOKEN; the other Secret variables stay as they are",
    );
    expect(JSON.stringify(lines)).not.toContain(NEW_SECRET);
  });

  it("drafts one Proposal of every section, each Secret value as a field by its name only", async () => {
    const { tool } = toolsWith();

    const draft = await tool.draft?.(tool.input.parse(GIVEN));

    expect(draft?.subject).toEqual({ kind: "project", id: "shop", title: "Shop" });
    expect(draft?.fields.map(({ label }) => label)).toEqual([
      "Environment variables",
      "Test targets",
      "Actions",
      "Run environment",
      "API_TOKEN (Secret variable)",
      "STRIPE_KEY (Secret variable of test target web)",
    ]);
    expect(draft?.fields.filter(({ form }) => form === "secret")).toEqual([
      { label: "API_TOKEN (Secret variable)", before: null, after: null, form: "secret" },
      {
        label: "STRIPE_KEY (Secret variable of test target web)",
        before: null,
        after: null,
        form: "secret",
      },
    ]);
    expect(JSON.stringify(draft)).not.toContain(NEW_SECRET);
    expect(JSON.stringify(draft)).not.toContain(SECRET_VALUE);
  });

  it("drafts a fingerprint of the sections as they stand, so a change since marks it out of date", async () => {
    const one = toolsWith();
    const other = toolsWith({ project: { ...SHOP, runEnvironment: "on" } as typeof SHOP });
    const given = { project: "shop", runEnvironment: "off", why: "x" };

    const first = await one.tool.draft?.(one.tool.input.parse(given));
    const second = await other.tool.draft?.(other.tool.input.parse(given));

    expect(first?.fingerprint).not.toEqual(second?.fingerprint);
  });

  it("applies the Proposal as the user who applies it, recorded as that Proposal", async () => {
    const { tool, changes } = toolsWith();
    const application: OfficeToolApplication = {
      user: ANN_LEE,
      proposedBy: "devops",
      proposalId: "proposal-1",
    };

    const result = await tool.applyFor?.(tool.input.parse(GIVEN), application);

    expect(result?.isError).toBe(false);
    expect(changes.map(({ method }) => method)).toEqual([
      "changeEnvironment",
      "testTargets.change",
      "actions.change",
      "runEnvironments.change",
    ]);
    for (const change of changes) {
      expect(change.args.at(-1)).toEqual({
        kind: "proposal",
        proposalId: "proposal-1",
        user: ANN_LEE,
      });
    }
  });

  it("applies a call apart from a stored Proposal as the user's own", async () => {
    const { tool, changes } = toolsWith();

    await tool.applyFor?.(tool.input.parse(GIVEN), { user: ANN_LEE, proposedBy: "devops" });

    for (const change of changes) {
      expect(change.args.at(-1)).toEqual({ kind: "user", user: ANN_LEE });
    }
  });
});
