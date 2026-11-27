import { describe, expect, it } from "vitest";
import {
  authorityInEffect,
  authorityProblems,
  PROPOSAL,
  type Authority,
  type AuthoritySetting,
} from "./authority.js";
import { authorityMovedOver } from "./authority-move-over.js";
import { DUTIES, type DutyKey } from "./duties.js";
import {
  jobSettingsMissingOn,
  jobSettingsOf,
  jobSettingsOfDutiesMissingOn,
  liftedFromNever,
  moreFree,
} from "./duty-jobs.js";
import { ALLOWED, ASK_ME, consult, NEVER, type HardSwitches } from "./hard-switches.js";
import { CARETAKER } from "./known-roles.js";
import { consultableRoleKeys } from "./presets.js";

const OWN_ALLOWED_OTHERS_ASK_ME: AuthoritySetting = {
  kind: "own-and-others",
  own: ALLOWED,
  others: ASK_ME,
};

/** Switches that give no row of the first move-over anything of their own. */
const NO_SWITCHES: HardSwitches = {
  runInstalls: NEVER,
  publishOutsideThePipeline: NEVER,
  changeRoles: NEVER,
  changeProjectSettings: NEVER,
};

describe("moreFree", () => {
  it("puts Allowed over Ask me, Consult and Proposal, which are alike, and those over Never", () => {
    expect(moreFree(ALLOWED, ASK_ME)).toBe(true);
    expect(moreFree(ALLOWED, NEVER)).toBe(true);
    expect(moreFree(PROPOSAL, NEVER)).toBe(true);
    expect(moreFree(consult("cto"), NEVER)).toBe(true);
    expect(moreFree(ASK_ME, ALLOWED)).toBe(false);
    expect(moreFree(NEVER, PROPOSAL)).toBe(false);
    expect(moreFree(ASK_ME, PROPOSAL)).toBe(false);
    expect(moreFree(PROPOSAL, ASK_ME)).toBe(false);
    expect(moreFree(NEVER, NEVER)).toBe(false);
  });
});

describe("the duties' job settings", () => {
  it("name only rows a card can take, none a capped row at Allowed", () => {
    for (const duty of DUTIES) {
      expect(authorityProblems("developer", duty.jobSettings, consultableRoleKeys([]))).toEqual([]);
    }
  });

  // The first move-over granted these rows to a duty's holder; they are the job's now, one source.
  it.each([
    [
      "default-person-to-talk-to",
      {
        initiativeRecords: OWN_ALLOWED_OTHERS_ASK_ME,
        changeRoles: PROPOSAL,
        promptTemplates: PROPOSAL,
        officeSettings: PROPOSAL,
      },
    ],
    ["shapes-initiatives", { initiativeRecords: OWN_ALLOWED_OTHERS_ASK_ME }],
    [
      "onboards-projects",
      {
        publishingSettings: PROPOSAL,
        projectSettings: PROPOSAL,
        projectUpkeep: ALLOWED,
        pipelinesAndStageTemplates: PROPOSAL,
      },
    ],
  ] as const)(
    "gives %s the rows the first move-over granted its holder, at the same settings",
    (duty, granted) => {
      const job = jobSettingsOf([duty as DutyKey]);
      const moved = authorityMovedOver("release-manager", NO_SWITCHES, new Set([duty as DutyKey]));
      // A Role from scratch, whose rows are Ask me: the moved rows are those the job named.
      for (const [group, setting] of Object.entries(granted)) {
        expect(job).toHaveProperty(group, setting);
        expect(moved).toHaveProperty(group, setting);
      }
    },
  );

  it("keeps the first move-over byte for byte what it was for a duty's own rows only", () => {
    // The later rows of a job are given by the second move-over alone.
    const moved = authorityMovedOver(
      "release-manager",
      NO_SWITCHES,
      new Set<DutyKey>(["default-person-to-talk-to"]),
    );

    expect(moved).not.toHaveProperty("postLinkCard");
    expect(moved).not.toHaveProperty("showOfficeStatus");
    expect(
      authorityMovedOver("release-manager", NO_SWITCHES, new Set<DutyKey>(["onboards-projects"])),
    ).not.toHaveProperty("proposeProjectCommands");
  });

  it("name the old duty tools' groups: Plans and Shapes Initiatives' record tools, Onboards Projects' upkeep", () => {
    expect(jobSettingsOf(["plans"])).toHaveProperty("initiativeRecords");
    expect(jobSettingsOf(["shapes-initiatives"])).toHaveProperty("taskRecords");
    expect(jobSettingsOf(["onboards-projects"])).toHaveProperty("projectUpkeep", ALLOWED);
    // The holder reaches the Proposals of the retired tools through Change Project settings.
    expect(jobSettingsOf(["onboards-projects"])).toMatchObject({ changeProjectSettings: PROPOSAL });
    expect(jobSettingsOf(["default-person-to-talk-to"])).toMatchObject({
      postLinkCard: ALLOWED,
      showOfficeStatus: ALLOWED,
      changeRoles: PROPOSAL,
    });
  });

  it("keeps the default holder of Onboards and repairs Projects at Change Project settings Proposal or better, as the retired Proposal tools reached", () => {
    const duty = DUTIES.find(({ key }) => key === "onboards-projects");
    if (!duty) throw new Error("The duty.");

    const holds = authorityInEffect(duty.defaultRoleKey, {}).changeProjectSettings;

    expect(holds.kind).not.toBe("never");
    expect(duty.jobSettings).toMatchObject({ changeProjectSettings: PROPOSAL });
    // A holder whose card leaves it Never is offered Proposal.
    expect(
      jobSettingsMissingOn("developer", { changeProjectSettings: NEVER }, "onboards-projects"),
    ).toMatchObject({ changeProjectSettings: PROPOSAL });
  });

  it("put a capped row at Proposal, never Allowed", () => {
    expect(jobSettingsOf(["default-person-to-talk-to"]).changeRoles).toEqual(PROPOSAL);
    expect(jobSettingsOf(["onboards-projects"]).publishingSettings).toEqual(PROPOSAL);
  });

  it("merge the freest of two duties' settings, own and others' apart", () => {
    const merged = jobSettingsOf(["shapes-initiatives", "plans", "default-person-to-talk-to"]);

    expect(merged.initiativeRecords).toEqual(OWN_ALLOWED_OTHERS_ASK_ME);
  });
});

describe("liftedFromNever", () => {
  it("takes the job's setting where the card says Never and leaves every freer side alone", () => {
    expect(liftedFromNever(NEVER, ALLOWED)).toEqual(ALLOWED);
    expect(liftedFromNever(ASK_ME, ALLOWED)).toEqual(ASK_ME);
    expect(liftedFromNever(NEVER, OWN_ALLOWED_OTHERS_ASK_ME)).toEqual(OWN_ALLOWED_OTHERS_ASK_ME);
    expect(
      liftedFromNever(
        { kind: "own-and-others", own: ALLOWED, others: NEVER },
        OWN_ALLOWED_OTHERS_ASK_ME,
      ),
    ).toEqual(OWN_ALLOWED_OTHERS_ASK_ME);
    expect(
      liftedFromNever(
        { kind: "own-and-others", own: ASK_ME, others: NEVER },
        OWN_ALLOWED_OTHERS_ASK_ME,
      ),
    ).toEqual(ASK_ME);
  });
});

describe("jobSettingsMissingOn", () => {
  it("is empty on a preset card that holds the job: the Office Manager's, the CTO's and Devops'", () => {
    expect(jobSettingsMissingOn("office-manager", {}, "default-person-to-talk-to")).toEqual({});
    expect(jobSettingsMissingOn("cto", {}, "shapes-initiatives")).toEqual({});
    expect(jobSettingsMissingOn("devops", {}, "onboards-projects")).toEqual({});
  });

  it("names the Planner's Initiative records for Plans, which its table leaves Never", () => {
    expect(jobSettingsMissingOn("planner", {}, "plans")).toEqual({
      initiativeRecords: OWN_ALLOWED_OTHERS_ASK_ME,
    });
  });

  it("names every row of Onboards and repairs Projects a Developer's card leaves Never, and none it set freer, such as a Developer's Consult on Change Project settings", () => {
    const missing = jobSettingsMissingOn(
      "developer",
      { projectUpkeep: ASK_ME },
      "onboards-projects",
    );

    expect(missing).toEqual({
      publishingSettings: PROPOSAL,
      projectSettings: PROPOSAL,
      pipelinesAndStageTemplates: PROPOSAL,
    });
  });

  it("leaves a row a card sets Never as Never, unless it is a row of the job: it lifts only the job's rows", () => {
    expect(jobSettingsMissingOn("devops", { movingWork: NEVER }, "onboards-projects")).toEqual({});
    expect(jobSettingsMissingOn("devops", { projectUpkeep: NEVER }, "onboards-projects")).toEqual({
      projectUpkeep: ALLOWED,
    });
  });

  it("is empty for the Caretaker, whose Authority is fixed", () => {
    expect(jobSettingsMissingOn(CARETAKER, {}, "default-person-to-talk-to")).toEqual({});
  });

  it("never gives a value the row can't take, a capped row at Proposal", () => {
    const missing = jobSettingsMissingOn("planner", {}, "default-person-to-talk-to");

    expect(missing.changeRoles).toEqual(PROPOSAL);
    expect(authorityProblems("planner", missing, consultableRoleKeys([]))).toEqual([]);
  });

  it("changes nothing once given: the card with the rows set is missing none", () => {
    for (const roleKey of ["planner", "developer", "reviewer", "release-manager"]) {
      const holds = DUTIES.map((duty) => duty.key as DutyKey);
      const missing = jobSettingsOfDutiesMissingOn(roleKey, {}, holds);
      const given: Authority = { ...missing };

      expect(jobSettingsOfDutiesMissingOn(roleKey, given, holds)).toEqual({});
      expect(authorityProblems(roleKey, given, consultableRoleKeys([]))).toEqual([]);
      // The card's effect only grew: no row of it got less free.
      const after = authorityInEffect(roleKey, given);
      const before = authorityInEffect(roleKey, {});
      for (const group of Object.keys(missing) as (keyof typeof after)[]) {
        expect(before[group]).toBeDefined();
        expect(after[group]).toBeDefined();
      }
    }
  });
});
