import { describe, expect, it } from "vitest";
import {
  AUTHORITY_GROUPS,
  authorityInEffect,
  authorityProblems,
  CARETAKER_AUTHORITY,
  hardSwitchesOf,
  PROPOSAL,
  type AuthorityGroup,
  type AuthoritySetting,
} from "./authority.js";
import { ALLOWED, ASK_ME, consult, NEVER } from "./hard-switches.js";
import { CARETAKER } from "./known-roles.js";
import { consultableRoleKeys } from "./presets.js";

const CONSULTABLE = consultableRoleKeys([]);

const ownAllowedOthersAskMe: AuthoritySetting = {
  kind: "own-and-others",
  own: ALLOWED,
  others: ASK_ME,
};

describe("authorityProblems", () => {
  // Spec §6 › The trust anchor: a capped row takes Proposal, Ask me or Never only.
  it.each([
    "changeRoles",
    "continueAtGateOnOwnWork",
    "secretValues",
    "publishingSettings",
    "approveHeldCallsAndApplyProposals",
  ] as const)(
    "refuses Allowed and Consult on %s, and takes Proposal, Ask me and Never",
    (group) => {
      for (const value of [ALLOWED, consult("devops")]) {
        expect(authorityProblems("developer", { [group]: value }, CONSULTABLE)).toEqual([
          expect.stringContaining("takes Proposal, Ask me or Never only."),
        ]);
      }
      for (const value of [PROPOSAL, ASK_ME, NEVER]) {
        expect(authorityProblems("developer", { [group]: value }, CONSULTABLE)).toEqual([]);
      }
    },
  );

  it.each(["runInstalls", "publishOutsideThePipeline"] as const)(
    "refuses Proposal on the followed %s, which no Office tool drafts",
    (group) => {
      expect(authorityProblems("developer", { [group]: PROPOSAL }, CONSULTABLE)).toEqual([
        expect.stringContaining("can't be Proposal: no Office tool drafts it."),
      ]);
    },
  );

  it("takes own and others' values on a record row only", () => {
    expect(
      authorityProblems("developer", { taskRecords: ownAllowedOthersAskMe }, CONSULTABLE),
    ).toEqual([]);
    expect(
      authorityProblems("developer", { movingWork: ownAllowedOthersAskMe }, CONSULTABLE),
    ).toEqual(["Moving work takes one value, the same on everyone's work."]);
  });

  it("refuses a Consult of a Role The Office doesn't know, and of the Role itself", () => {
    expect(
      authorityProblems("developer", { runInstalls: consult("janitor") }, CONSULTABLE),
    ).toEqual(["Run installs consults a Role The Office doesn't know."]);
    expect(authorityProblems("devops", { checks: consult("devops") }, CONSULTABLE)).toEqual([
      "Checks can't consult the Role itself.",
    ]);
  });

  // The Plan's choice: a preset Role nobody has hired asks the user until it is.
  it("takes a Consult of a preset Role nobody has hired", () => {
    expect(authorityProblems("developer", { checks: consult("cto") }, CONSULTABLE)).toEqual([]);
  });

  it("refuses any row on the Caretaker, whose Authority is fixed", () => {
    expect(authorityProblems(CARETAKER, {}, CONSULTABLE)).toEqual([]);
    expect(authorityProblems(CARETAKER, { runInstalls: ALLOWED }, CONSULTABLE)).toEqual([
      "The Caretaker's Authority is fixed.",
    ]);
  });
});

describe("the Caretaker's Authority", () => {
  // Spec §2.2 › Caretaker: its reach before Authority, each drafting row Proposal.
  it("is its fixed Authority whatever the card sets", () => {
    const proposals: AuthorityGroup[] = [
      "changeRoles",
      "officeSettings",
      "skills",
      "pipelinesAndStageTemplates",
      "promptTemplates",
      "projectSettings",
    ];
    const expected = Object.fromEntries(
      AUTHORITY_GROUPS.map((group): [AuthorityGroup, AuthoritySetting] => {
        if (group === "taskRecords" || group === "ideas") return [group, ownAllowedOthersAskMe];
        if (["captureIdea", "runInstalls", "publishOutsideThePipeline"].includes(group)) {
          return [group, ALLOWED];
        }
        return [group, proposals.includes(group) ? PROPOSAL : NEVER];
      }),
    );

    expect(CARETAKER_AUTHORITY).toEqual(expected);
    expect(authorityInEffect(CARETAKER, {})).toEqual(expected);
    expect(authorityInEffect(CARETAKER, { runInstalls: NEVER })).toEqual(expected);
  });
});

describe("hardSwitchesOf", () => {
  // Each preset's Hard switches before Authority (spec §6), Proposal read as Never.
  it.each([
    ["planner", [consult("devops"), NEVER, NEVER, NEVER]],
    ["developer", [consult("devops"), consult("cto"), NEVER, consult("devops")]],
    ["reviewer", [consult("devops"), NEVER, NEVER, NEVER]],
    ["cto", [consult("devops"), ASK_ME, NEVER, consult("devops")]],
    ["devops", [ALLOWED, consult("cto"), NEVER, ALLOWED]],
    ["office-manager", [NEVER, NEVER, NEVER, NEVER]],
    [CARETAKER, [ALLOWED, ALLOWED, NEVER, NEVER]],
  ] as const)("gives the %s preset's Hard switches at its defaults", (roleKey, switches) => {
    const [runInstalls, publishOutsideThePipeline, changeRoles, changeProjectSettings] = switches;
    expect(hardSwitchesOf(roleKey, {})).toEqual({
      runInstalls,
      publishOutsideThePipeline,
      changeRoles,
      changeProjectSettings,
    });
  });
});
