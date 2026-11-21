import { describe, expect, it } from "vitest";
import { ProjectRefused } from "./project-refused.js";
import {
  appliedTargets,
  proposedFieldsOf,
  proposedTestTargets,
  proposedTestTargetsProblems,
  type ProposedTestTargetFields,
} from "./proposed-test-targets.js";
import type { TestTarget, TestTargetSetter } from "./test-target.js";

const ANN: TestTargetSetter = { by: "user", user: { userId: "user-ann", name: "Ann" } };
const PROPOSAL: TestTargetSetter = {
  by: "proposal",
  proposalId: "proposal-1",
  agent: { roleKey: "devops", name: "Dana" },
};

const WEB: TestTarget = {
  key: "web",
  name: "Web app",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "start", arguments: [] },
  port: 5173,
  portVariable: "PORT",
  variables: [],
  secretVariables: [{ name: "API_KEY", value: "api-s3cret" }],
  commandsBefore: [],
  memoryMegabytes: null,
  setBy: { name: ANN, port: ANN },
};

const ANDROID: ProposedTestTargetFields = {
  key: "android",
  name: "Android",
  kind: "build-to-install",
  entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
  outputPatterns: ["app/build/outputs/apk/debug/*.apk"],
  variables: [],
  secretVariables: ["SIGNING_KEY"],
  commandsBefore: ["build"],
  memoryMegabytes: 1024,
};

/** The Project's command keys, which a target's commands before the entry point name. */
const COMMAND_KEYS = ["build", "lint", "test"];

/** The Hosted target's fields, so a test can change its port. */
const WEB_FIELDS = proposedFieldsOf(WEB) as Extract<ProposedTestTargetFields, { kind: "hosted" }>;

function refusalOf(work: () => unknown): readonly string[] {
  try {
    work();
  } catch (error) {
    if (error instanceof ProjectRefused) return error.reasons;
    throw error;
  }
  throw new Error("Not refused.");
}

describe("proposedTestTargets", () => {
  it("keeps each target changed as it is and as proposed, leaving out those it doesn't change", () => {
    const proposed = proposedTestTargets([WEB], {
      targets: [proposedFieldsOf(WEB), ANDROID],
    });

    expect(proposed).toEqual({
      targets: [{ key: "android", from: null, to: ANDROID, userSet: [] }],
    });
  });

  it("refuses changing a value the user set unless it is named, naming each as key.field", () => {
    const given = {
      targets: [{ ...WEB_FIELDS, name: "Web", port: 3000, variables: [{ name: "A", value: "b" }] }],
    };

    expect(refusalOf(() => proposedTestTargets([WEB], given))).toEqual([
      "The user set web.name, web.port, which this changes: name each in changeUserSet to change it on purpose, or leave it as it is.",
    ]);
    expect(
      proposedTestTargets([WEB], { ...given, changeUserSet: ["web.name", "web.port"] }).targets[0]
        ?.userSet,
    ).toEqual(["name", "port"]);
  });

  it("counts removing a target as changing each value the user set, and refuses a key not there", () => {
    expect(
      refusalOf(() => proposedTestTargets([WEB], { targets: [], removeTargets: ["web"] })),
    ).toEqual([
      "The user set web.name, web.port, which this changes: name each in changeUserSet to change it on purpose, or leave it as it is.",
    ]);
    expect(
      refusalOf(() => proposedTestTargets([WEB], { targets: [], removeTargets: ["ios"] })),
    ).toEqual([`The Project has no test target with the key "ios" to remove.`]);
    expect(
      refusalOf(() => proposedTestTargets([WEB], { targets: [proposedFieldsOf(WEB)] })),
    ).toEqual([
      "Nothing changes: give the test targets to add or change, each one whole, or the keys to remove.",
    ]);
  });
});

describe("proposedTestTargetsProblems", () => {
  it("names each target changed since it was drafted, before any other rule", () => {
    const proposed = proposedTestTargets([WEB], {
      targets: [
        { ...WEB_FIELDS, port: 0 },
        { ...ANDROID, key: "ios" },
      ],
      changeUserSet: ["web.port"],
    });
    const now: TestTarget[] = [
      { ...WEB, entryPoint: { kind: "repository-file", path: "start.sh", arguments: [] } },
      { ...ANDROID, key: "ios", secretVariables: [], setBy: {} },
    ];

    expect(proposedTestTargetsProblems(now, proposed, COMMAND_KEYS)).toEqual([
      `Test target "web" changed since this was proposed.`,
      `Test target "ios" was added since this was proposed.`,
    ]);
    expect(proposedTestTargetsProblems([WEB], proposed, COMMAND_KEYS)).toEqual([
      `Test target "web": Its port must be a whole number from 1 to 65535.`,
    ]);
  });

  it("holds when only a Secret variable's value changed since, as a Proposal reads names alone", () => {
    const proposed = proposedTestTargets([WEB], { targets: [ANDROID] });
    const typedSince = { ...WEB, secretVariables: [{ name: "API_KEY", value: "another-value" }] };

    expect(proposedTestTargetsProblems([typedSince], proposed, COMMAND_KEYS)).toEqual([]);
  });

  it("refuses a command before the entry point the Project no longer has, as the page does", () => {
    const proposed = proposedTestTargets([WEB], { targets: [ANDROID] });

    expect(proposedTestTargetsProblems([WEB], proposed, ["lint", "test"])).toEqual([
      `Test target "android": The command build in its commands before the entry point isn't one of the Project's commands.`,
    ]);
  });
});

describe("appliedTargets", () => {
  it("keeps the values of Secret variables kept by name and stamps the Proposal on what changed", () => {
    const proposed = proposedTestTargets([WEB], {
      targets: [{ ...WEB_FIELDS, port: 3000, secretVariables: ["API_KEY", "MAPS_KEY"] }, ANDROID],
      changeUserSet: ["web.port"],
    });

    expect(appliedTargets([WEB], proposed, PROPOSAL)).toEqual([
      {
        ...WEB,
        port: 3000,
        secretVariables: [
          { name: "API_KEY", value: "api-s3cret" },
          { name: "MAPS_KEY", value: null },
        ],
        setBy: { name: ANN, port: PROPOSAL, secretVariables: PROPOSAL },
      },
      {
        ...ANDROID,
        secretVariables: [{ name: "SIGNING_KEY", value: null }],
        setBy: {
          name: PROPOSAL,
          kind: PROPOSAL,
          entryPoint: PROPOSAL,
          outputPatterns: PROPOSAL,
          variables: PROPOSAL,
          secretVariables: PROPOSAL,
          commandsBefore: PROPOSAL,
          memoryMegabytes: PROPOSAL,
        },
      },
    ]);
  });
});
