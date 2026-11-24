import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  ASK_ME,
  consult,
  HARD_SWITCH_ENFORCEMENT,
  HARD_SWITCH_KEYS,
  HARD_SWITCH_LABELS,
  hardSwitchesProblems,
  hardSwitchInEffect,
  NEVER,
  switchesAskingYouUntilHired,
  type HardSwitches,
} from "./hard-switches.js";
import { consultableRoleKeys } from "./presets.js";

/** The presets' Roles, and a Role hired from scratch under `data-analyst`. */
const CONSULTABLE = consultableRoleKeys(["data-analyst", "caretaker"]);

const switches = (fields: Partial<HardSwitches> = {}): HardSwitches => ({
  runInstalls: consult("devops"),
  publishOutsideThePipeline: consult("cto"),
  changeRoles: NEVER,
  changeProjectSettings: NEVER,
  ...fields,
});

describe("hardSwitchesProblems", () => {
  it.each([ALLOWED, ASK_ME, NEVER, consult("planner")])(
    "accepts %o for a followed switch",
    (value) => {
      expect(
        hardSwitchesProblems("developer", switches({ runInstalls: value }), CONSULTABLE),
      ).toEqual([]);
    },
  );

  it.each([ALLOWED, ASK_ME, NEVER, consult("cto")])(
    "accepts %o for Change Roles, an enforced switch",
    (value) => {
      expect(
        hardSwitchesProblems("developer", switches({ changeRoles: value }), CONSULTABLE),
      ).toEqual([]);
    },
  );

  it("refuses Change Project settings, an enforced switch, consulting the Role itself", () => {
    expect(
      hardSwitchesProblems(
        "devops",
        switches({ runInstalls: ALLOWED, changeProjectSettings: consult("devops") }),
        CONSULTABLE,
      ),
    ).toEqual(["Change Project settings can't consult the Role itself."]);
  });

  it("refuses a Consult value naming a Role The Office doesn't know, or the Role itself", () => {
    const problems = hardSwitchesProblems(
      "developer",
      switches({
        runInstalls: consult("janitor"),
        publishOutsideThePipeline: consult("developer"),
      }),
      CONSULTABLE,
    );

    expect(problems).toEqual([
      "Run installs consults a Role The Office doesn't know.",
      "Publish outside the Pipeline can't consult the Role itself.",
    ]);
  });

  it("lets a switch consult a Role hired from scratch, but never the Caretaker", () => {
    expect(
      hardSwitchesProblems(
        "developer",
        switches({ runInstalls: consult("data-analyst"), changeRoles: consult("caretaker") }),
        CONSULTABLE,
      ),
    ).toEqual(["Change Roles consults a Role The Office doesn't know."]);
  });
});

describe("the Hard switches", () => {
  it("enforce Change Roles and Change Project settings in code, and leave the rest to the Agent", () => {
    expect(HARD_SWITCH_KEYS.map((key) => [key, HARD_SWITCH_ENFORCEMENT[key]])).toEqual([
      ["runInstalls", "followed"],
      ["publishOutsideThePipeline", "followed"],
      ["changeRoles", "enforced"],
      ["changeProjectSettings", "enforced"],
    ]);
    expect(HARD_SWITCH_LABELS.changeProjectSettings).toBe("Change Project settings");
  });
});

describe("switchesAskingYouUntilHired", () => {
  it("names the switches consulting a Role nobody fills", () => {
    const asking = switchesAskingYouUntilHired(
      switches({ publishOutsideThePipeline: consult("planner") }),
      new Set(["developer", "planner"]),
    );

    expect(asking).toEqual(["runInstalls"]);
  });
});

describe("hardSwitchInEffect", () => {
  it("asks the user while nobody fills the Role to consult", () => {
    expect(hardSwitchInEffect(consult("devops"), new Set(["developer"]))).toEqual(ASK_ME);
  });

  it("consults the Role once it is filled", () => {
    expect(hardSwitchInEffect(consult("devops"), new Set(["devops"]))).toEqual(consult("devops"));
  });

  it.each([ALLOWED, ASK_ME, NEVER])("keeps %o as it is", (value) => {
    expect(hardSwitchInEffect(value, new Set())).toBe(value);
  });
});
