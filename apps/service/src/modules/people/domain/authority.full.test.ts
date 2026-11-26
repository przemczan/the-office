import { describe, expect, it } from "vitest";
import {
  AUTHORITY_GROUPS,
  authorityInEffect,
  authorityWithHardSwitches,
  FROM_SCRATCH_AUTHORITY,
  keptAuthority,
  presetAuthority,
  PROPOSAL,
  rowsAskingYouUntilHired,
  valuesTakenBy,
  withoutPresetDefaults,
  type AuthorityGroup,
  type AuthoritySetting,
  type AuthorityValue,
} from "./authority.js";
import { ALLOWED, ASK_ME, consult, NEVER } from "./hard-switches.js";
import { CARETAKER } from "./known-roles.js";

/**
 * The design's "Authority by role" table (docs/design/who-can-do-what.md), cell for cell: Planner,
 * Developer, Reviewer, CTO, Devops, Office Manager, from scratch.
 */
const TABLE: Readonly<Record<AuthorityGroup, readonly string[]>> = {
  taskRecords: ["A·Q", "A·Q", "A·N", "A·Q", "A·Q", "N", "Q"],
  movingWork: ["Q", "N", "N", "Q", "N", "Q", "Q"],
  gatesAndRuns: ["N", "N", "N", "Q", "N", "Q", "Q"],
  continueAtGateOnOwnWork: ["N", "N", "N", "Q", "N", "N", "N"],
  initiativeRecords: ["N", "N", "N", "A·Q", "N", "A·Q", "Q"],
  runningAnInitiative: ["N", "N", "N", "Q", "N", "Q", "Q"],
  ideas: ["A·Q", "A·Q", "A·N", "A·Q", "A·Q", "A·Q", "Q"],
  captureIdea: ["A", "A", "A", "A", "A", "A", "A"],
  changeProjectSettings: ["N", "C devops", "N", "C devops", "A", "N", "Q"],
  publishingSettings: ["N", "N", "N", "N", "P", "N", "N"],
  projectSettings: ["N", "N", "N", "N", "P", "N", "Q"],
  projectUpkeep: ["N", "N", "N", "N", "A", "N", "Q"],
  secretValues: ["N", "N", "N", "N", "N", "N", "N"],
  changeRoles: ["N", "N", "N", "N", "N", "P", "N"],
  memoryAndAvatar: ["Q", "N", "N", "Q", "Q", "Q", "Q"],
  skills: ["P", "P", "P", "P", "P", "P", "P"],
  mcpServers: ["N", "N", "N", "N", "P", "N", "Q"],
  pipelinesAndStageTemplates: ["N", "N", "N", "N", "P", "N", "Q"],
  promptTemplates: ["N", "N", "N", "N", "N", "P", "Q"],
  officeSettings: ["N", "N", "N", "N", "N", "P", "Q"],
  testInstances: ["N", "A", "A", "A", "A", "N", "Q"],
  projectDevices: ["N", "Q", "N", "N", "Q", "N", "Q"],
  fireAlarm: ["N", "N", "N", "A", "A", "A", "Q"],
  checks: ["N", "N", "N", "A", "A", "A", "Q"],
  updatesAndRestarts: ["N", "N", "N", "N", "Q", "Q", "Q"],
  runInstalls: ["C devops", "C devops", "C devops", "C devops", "A", "N", "Q"],
  publishOutsideThePipeline: ["N", "C cto", "N", "Q", "C cto", "N", "Q"],
  approveHeldCallsAndApplyProposals: ["N", "N", "N", "N", "N", "N", "N"],
};

const COLUMNS = ["planner", "developer", "reviewer", "cto", "devops", "office-manager", "scratch"];

function valueOf(cell: string): AuthorityValue {
  if (cell.startsWith("C ")) return consult(cell.slice(2));
  return { A: ALLOWED, Q: ASK_ME, N: NEVER, P: PROPOSAL }[cell] ?? ALLOWED;
}

function settingOf(cell: string): AuthoritySetting {
  const [own, others] = cell.split("·");
  return own !== undefined && others !== undefined
    ? { kind: "own-and-others", own: valueOf(own), others: valueOf(others) }
    : valueOf(cell);
}

function column(index: number): Record<AuthorityGroup, AuthoritySetting> {
  return Object.fromEntries(
    AUTHORITY_GROUPS.map((group) => [group, settingOf(TABLE[group][index] ?? "")]),
  ) as Record<AuthorityGroup, AuthoritySetting>;
}

describe("the presets' Authority", () => {
  it.each(COLUMNS.slice(0, 6).map((roleKey, index) => [roleKey, index] as const))(
    "gives the %s the design table's defaults, every cell",
    (roleKey, index) => {
      expect(presetAuthority(roleKey)).toEqual(column(index));
      expect(authorityInEffect(roleKey, {})).toEqual(column(index));
    },
  );

  it("gives a Role hired from scratch Ask me, the capped rows Never, Skills Proposal and capture_idea Allowed", () => {
    expect(FROM_SCRATCH_AUTHORITY).toEqual(column(6));
    expect(presetAuthority("release-manager")).toEqual(column(6));
  });

  it("puts a set row over the preset's default", () => {
    expect(authorityInEffect("developer", { movingWork: ASK_ME })).toEqual({
      ...column(1),
      movingWork: ASK_ME,
    });
  });
});

describe("the values a row takes", () => {
  it("gives a capped row Proposal, Ask me and Never, a followed row no Proposal, the others all", () => {
    expect(valuesTakenBy("secretValues")).toEqual(["proposal", "ask-me", "never"]);
    expect(valuesTakenBy("runInstalls")).toEqual(["allowed", "consult", "ask-me", "never"]);
    expect(valuesTakenBy("checks")).toEqual(["allowed", "consult", "ask-me", "proposal", "never"]);
  });
});

describe("keeping an Authority", () => {
  it("keeps a pair of equal sides as its one value, and a value equal to the default as set", () => {
    expect(
      keptAuthority({
        ideas: { kind: "own-and-others", own: ASK_ME, others: ASK_ME },
        movingWork: NEVER,
      }),
    ).toEqual({ ideas: ASK_ME, movingWork: NEVER });
  });

  it("leaves out what equals the preset's default when asked to", () => {
    expect(withoutPresetDefaults("developer", { movingWork: NEVER, checks: ALLOWED })).toEqual({
      checks: ALLOWED,
    });
  });
});

describe("rowsAskingYouUntilHired", () => {
  it("names each row consulting a Role nobody fills, an own or others' value too", () => {
    const inEffect = authorityInEffect("developer", {
      checks: { kind: "own-and-others", own: ALLOWED, others: consult("planner") },
    });

    expect(rowsAskingYouUntilHired(inEffect, new Set(["devops"]))).toEqual([
      "checks",
      "publishOutsideThePipeline",
    ]);
    expect(rowsAskingYouUntilHired(inEffect, new Set(["cto"]))).toEqual([
      "changeProjectSettings",
      "checks",
      "runInstalls",
    ]);
    expect(rowsAskingYouUntilHired(inEffect, new Set(["cto", "devops", "planner"]))).toEqual([]);
  });
});

describe("authorityWithHardSwitches", () => {
  const developerSwitches = {
    runInstalls: consult("devops"),
    publishOutsideThePipeline: consult("cto"),
    changeRoles: NEVER,
    changeProjectSettings: consult("devops"),
  };

  it("sets nothing for switches at the Authority's view of them", () => {
    expect(authorityWithHardSwitches("developer", {}, developerSwitches)).toEqual({});
    expect(authorityWithHardSwitches("developer", { checks: ALLOWED }, developerSwitches)).toEqual({
      checks: ALLOWED,
    });
  });

  it.each([
    ["Allowed", ALLOWED],
    ["Consult", consult("planner")],
    ["Ask me", ASK_ME],
    ["Never", NEVER],
  ] as const)("sets a switch changed to %s", (_name, value) => {
    const base = { runInstalls: ALLOWED, publishOutsideThePipeline: NEVER };
    const switches = {
      runInstalls: value,
      publishOutsideThePipeline: value,
      changeRoles: NEVER,
      changeProjectSettings: value,
    };

    // Run installs at Allowed already stays so; every other switch differs from its view, and is set.
    expect(authorityWithHardSwitches("developer", base, switches)).toEqual({
      runInstalls: value,
      publishOutsideThePipeline: value,
      changeProjectSettings: value,
    });
  });

  it.each([
    ["Allowed", ALLOWED, ASK_ME],
    ["Consult", consult("devops"), ASK_ME],
    ["Ask me", ASK_ME, ASK_ME],
    ["Never", NEVER, undefined],
  ] as const)("holds Change Roles %s to the trust anchor's cap", (_name, changeRoles, expected) => {
    expect(
      authorityWithHardSwitches("developer", {}, { ...developerSwitches, changeRoles }),
    ).toEqual(expected ? { changeRoles: expected } : {});
  });

  it("reads Change Roles Never as a Proposal it overrides on the Office Manager", () => {
    // The Office Manager's Change Roles is Proposal, read as Never: Never keeps it.
    const officeManager = {
      runInstalls: NEVER,
      publishOutsideThePipeline: NEVER,
      changeRoles: NEVER,
      changeProjectSettings: NEVER,
    };
    expect(authorityWithHardSwitches("office-manager", {}, officeManager)).toEqual({});
    expect(
      authorityWithHardSwitches("office-manager", {}, { ...officeManager, changeRoles: ASK_ME }),
    ).toEqual({ changeRoles: ASK_ME });
  });

  it("reads a missing Change Project settings as Ask me", () => {
    const { changeProjectSettings: _missing, ...switches } = developerSwitches;

    expect(authorityWithHardSwitches("developer", {}, switches)).toEqual({
      changeProjectSettings: ASK_ME,
    });
    expect(
      authorityWithHardSwitches("release-manager", {}, { ...switches, changeRoles: NEVER }),
    ).toEqual({ runInstalls: consult("devops"), publishOutsideThePipeline: consult("cto") });
  });

  it("gives the Caretaker no row, whatever its switches", () => {
    expect(authorityWithHardSwitches(CARETAKER, {}, { runInstalls: NEVER })).toEqual({});
  });
});
