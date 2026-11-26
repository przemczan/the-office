import { describe, expect, it } from "vitest";
import { PROPOSAL, type AuthoritySetting } from "./authority.js";
import { authorityMovedOver, instructionsMovedOver } from "./authority-move-over.js";
import { DUTIES, type DutyKey } from "./duties.js";
import { ALLOWED, ASK_ME, consult, NEVER, type HardSwitches } from "./hard-switches.js";
import { CARETAKER } from "./known-roles.js";
import { presetFor } from "./presets.js";

/** Each preset's Hard switches before Authority (spec §6 as it was). */
const SWITCHES_BEFORE: Readonly<Record<string, HardSwitches>> = {
  planner: {
    runInstalls: consult("devops"),
    publishOutsideThePipeline: NEVER,
    changeRoles: NEVER,
    changeProjectSettings: NEVER,
  },
  developer: {
    runInstalls: consult("devops"),
    publishOutsideThePipeline: consult("cto"),
    changeRoles: NEVER,
    changeProjectSettings: consult("devops"),
  },
  reviewer: {
    runInstalls: consult("devops"),
    publishOutsideThePipeline: NEVER,
    changeRoles: NEVER,
    changeProjectSettings: NEVER,
  },
  cto: {
    runInstalls: consult("devops"),
    publishOutsideThePipeline: ASK_ME,
    changeRoles: NEVER,
    changeProjectSettings: consult("devops"),
  },
  devops: {
    runInstalls: ALLOWED,
    publishOutsideThePipeline: consult("cto"),
    changeRoles: NEVER,
    changeProjectSettings: ALLOWED,
  },
  "office-manager": {
    runInstalls: NEVER,
    publishOutsideThePipeline: NEVER,
    changeRoles: ASK_ME,
    changeProjectSettings: NEVER,
  },
};

function switchesOf(roleKey: string): HardSwitches {
  const switches = SWITCHES_BEFORE[roleKey];
  if (!switches) throw new Error(`No switches for ${roleKey}.`);
  return switches;
}

/** The duties a Role holds while none is set: those whose default names it. */
function defaultDutiesOf(roleKey: string): ReadonlySet<DutyKey> {
  return new Set(
    DUTIES.filter((duty) => duty.defaultRoleKey === roleKey).map((duty) => duty.key as DutyKey),
  );
}

const ownAllowedOthersAskMe: AuthoritySetting = {
  kind: "own-and-others",
  own: ALLOWED,
  others: ASK_ME,
};

describe("authorityMovedOver", () => {
  // Design "who can do what" › 2: each preset hired before Authority, with its default duties.
  it.each([
    ["planner", {}],
    ["developer", {}],
    ["cto", {}],
    ["devops", {}],
    ["reviewer", { taskRecords: ownAllowedOthersAskMe, ideas: ownAllowedOthersAskMe }],
    ["office-manager", { changeRoles: ASK_ME }],
  ])("moves the %s at its preset's switches and default duties over to %o", (roleKey, moved) => {
    expect(authorityMovedOver(roleKey, switchesOf(roleKey), defaultDutiesOf(roleKey))).toEqual(
      moved,
    );
  });

  it.each([
    ["Allowed", ALLOWED],
    ["Consult", consult("cto")],
    ["Ask me", ASK_ME],
  ])("holds Change Roles %s to the trust anchor's cap, as Ask me", (_name, changeRoles) => {
    const switches = { ...switchesOf("developer"), changeRoles };

    expect(authorityMovedOver("developer", switches, new Set())).toEqual({ changeRoles: ASK_ME });
    expect(
      authorityMovedOver("office-manager", switches, defaultDutiesOf("office-manager")),
    ).toMatchObject({ changeRoles: ASK_ME });
  });

  it("moves Change Roles Never to Proposal for the Default person to talk to's holder, else Never", () => {
    const switches = switchesOf("developer");

    expect(authorityMovedOver("developer", switches, new Set())).toEqual({});
    expect(
      authorityMovedOver("developer", switches, new Set(["default-person-to-talk-to"])),
    ).toMatchObject({
      changeRoles: PROPOSAL,
      promptTemplates: PROPOSAL,
      officeSettings: PROPOSAL,
      // The Default person to talk to had no create_task, only Initiatives.
      taskRecords: NEVER,
      initiativeRecords: ownAllowedOthersAskMe,
    });
    expect(
      authorityMovedOver(
        "office-manager",
        { ...switchesOf("office-manager"), changeRoles: NEVER },
        defaultDutiesOf("office-manager"),
      ),
    ).toEqual({});
  });

  it("gives the holder of Onboards and repairs Projects its drafting and upkeep rows", () => {
    expect(authorityMovedOver("cto", switchesOf("cto"), new Set(["onboards-projects"]))).toEqual({
      initiativeRecords: NEVER,
      publishingSettings: PROPOSAL,
      projectSettings: PROPOSAL,
      projectUpkeep: ALLOWED,
      pipelinesAndStageTemplates: PROPOSAL,
    });
  });

  it("keeps a Role hired from scratch's switches, and its records' cover", () => {
    const switches: HardSwitches = {
      runInstalls: consult("devops"),
      publishOutsideThePipeline: ASK_ME,
      changeRoles: NEVER,
      changeProjectSettings: ALLOWED,
    };

    expect(authorityMovedOver("release-manager", switches, new Set())).toEqual({
      taskRecords: ownAllowedOthersAskMe,
      initiativeRecords: NEVER,
      ideas: ownAllowedOthersAskMe,
      changeProjectSettings: ALLOWED,
      projectSettings: NEVER,
      projectUpkeep: NEVER,
      pipelinesAndStageTemplates: NEVER,
      promptTemplates: NEVER,
      officeSettings: NEVER,
      runInstalls: consult("devops"),
    });
  });

  it("gives the Caretaker no row, its Authority fixed", () => {
    expect(authorityMovedOver(CARETAKER, switchesOf("devops"), new Set())).toEqual({});
  });
});

/** The Planner's instructions as the preset had them before Authority. */
const PLANNER_BEFORE = [
  "Plan in conversation: ask what is unclear, propose a Plan and a Definition of Done, and keep them short. Propose the smallest Pipeline that fits. A Task is Ready only when the user agrees.",
  "Decide alone: drafting a Plan and a Definition of Done, proposing a Pipeline from the library, correcting a Task or an Idea for your own mistake or what the user clarified (its fields, Dropping it before it starts, Archiving or Restoring it).",
  "Consult the CTO first: a Plan that touches architecture.",
  "Ask the user: marking a Task Ready, splitting a Task in two, Dropping a Task or an Idea somebody else created. A started Task is the user's to Drop.",
].join("\n\n");

describe("instructionsMovedOver", () => {
  it("gives a card still holding the preset's earlier instructions word for word the preset's now", () => {
    expect(instructionsMovedOver("planner", PLANNER_BEFORE)).toBe(
      presetFor("planner")?.card.instructions,
    );
  });

  it("keeps instructions the user edited, by as little as a word", () => {
    const edited = PLANNER_BEFORE.replace("keep them short", "keep them very short");

    expect(instructionsMovedOver("planner", edited)).toBe(edited);
    expect(instructionsMovedOver("planner", `${PLANNER_BEFORE}\n\nAlso this.`)).toBe(
      `${PLANNER_BEFORE}\n\nAlso this.`,
    );
  });

  it("keeps the instructions of a Role no preset has, and another preset's words", () => {
    expect(instructionsMovedOver("release-manager", PLANNER_BEFORE)).toBe(PLANNER_BEFORE);
    expect(instructionsMovedOver("developer", PLANNER_BEFORE)).toBe(PLANNER_BEFORE);
  });
});
