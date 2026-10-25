import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  ASK_ME,
  consult,
  hardSwitchesProblems,
  hardSwitchInEffect,
  NEVER,
  switchesAskingYouUntilHired,
  type HardSwitches,
} from "./hard-switches.js";

const switches = (fields: Partial<HardSwitches> = {}): HardSwitches => ({
  runInstalls: consult("devops"),
  publishOutsideThePipeline: consult("cto"),
  changeRoles: NEVER,
  ...fields,
});

describe("hardSwitchesProblems", () => {
  it.each([ALLOWED, ASK_ME, NEVER, consult("planner")])(
    "accepts %o for a followed switch",
    (value) => {
      expect(hardSwitchesProblems("developer", switches({ runInstalls: value }))).toEqual([]);
    },
  );

  it("refuses a Consult value naming a Role The Office doesn't know, or the Role itself", () => {
    const problems = hardSwitchesProblems(
      "developer",
      switches({
        runInstalls: consult("janitor"),
        publishOutsideThePipeline: consult("developer"),
      }),
    );

    expect(problems).toEqual([
      "Run installs consults a Role The Office doesn't know.",
      "Publish outside the Pipeline can't consult the Role itself.",
    ]);
  });

  it.each([ALLOWED, ASK_ME, consult("cto")])(
    "keeps Change Roles at Never, refusing %o",
    (value) => {
      expect(hardSwitchesProblems("developer", switches({ changeRoles: value }))).toEqual([
        "Change Roles stays Never until The Office can hold a call for it.",
      ]);
    },
  );
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
