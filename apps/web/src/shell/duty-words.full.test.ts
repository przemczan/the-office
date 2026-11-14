import { describe, expect, it } from "vitest";
import { CARETAKER, DEVELOPER_LET_GO, DEVOPS, dutyOf, PLANNER } from "./duty-words.fixtures.ts";
import {
  dutiesHeldBy,
  dutyCountWords,
  fallbackWords,
  holderName,
  holderNameOf,
  holderOptions,
  labelsFallingBackTo,
  letGoHolderWords,
  passedOverWords,
} from "./duty-words.ts";

describe("the duty words", () => {
  it("offers only hired Roles, leaving out the Caretaker and anyone let go", () => {
    expect(holderOptions([CARETAKER, PLANNER, DEVELOPER_LET_GO, DEVOPS])).toEqual([
      { value: "planner", label: "Angela · Planner" },
      { value: "devops", label: "Dwight · Devops" },
    ]);
  });

  it("says what happens while nobody holds each kind of duty", () => {
    expect(fallbackWords("default-person-to-talk-to")).toBe("The Caretaker is the one to talk to.");
    expect(fallbackWords("plans")).toBe("You do it yourself.");
    expect(fallbackWords("shapes-initiatives")).toBe("You do it yourself.");
    expect(fallbackWords("implements")).toBe(
      "Pipelines whose Stages name it are flagged, and Start is refused.",
    );
    expect(fallbackWords("reviews")).toBe(fallbackWords("implements"));
  });

  it("names the duties that fall back the same way", () => {
    const duties = [
      dutyOf("default-person-to-talk-to", "Default person to talk to", null, null),
      dutyOf("plans", "Plans", null, null),
      dutyOf("implements", "Implements", null, null),
      dutyOf("reviews", "Reviews", null, null),
    ];
    expect(labelsFallingBackTo("caretaker", duties)).toEqual(["Default person to talk to"]);
    expect(labelsFallingBackTo("unstaffed", duties)).toEqual(["Implements", "Reviews"]);
    expect(labelsFallingBackTo("user", duties)).toEqual(["Plans"]);
  });

  it("names a holder, or Nobody", () => {
    expect(holderName(dutyOf("plans", "Plans", "planner", PLANNER))).toBe("Angela · Planner");
    expect(holderName(dutyOf("plans", "Plans", null, null))).toBe("Nobody");
    expect(holderNameOf("planner", [PLANNER])).toBe("Angela · Planner");
    expect(holderNameOf(null, [PLANNER])).toBe("Nobody");
    expect(holderNameOf("cto", [PLANNER])).toBe("cto");
  });

  it("lists the duties a person holds, in the duties' order", () => {
    const duties = [
      dutyOf("plans", "Plans", "planner", PLANNER),
      dutyOf("onboards-projects", "Onboards and repairs Projects", "devops", DEVOPS),
      dutyOf("reviews", "Reviews", "planner", PLANNER),
    ];
    expect(dutiesHeldBy(duties, "planner").map(({ key }) => key)).toEqual(["plans", "reviews"]);
    expect(dutiesHeldBy(duties, "caretaker")).toEqual([]);
    expect(dutyCountWords(1)).toBe("1 duty");
    expect(dutyCountWords(2)).toBe("2 duties");
  });

  it("says a duty is unheld because its holder was let go, and only then", () => {
    const roles = [PLANNER, DEVELOPER_LET_GO];
    expect(letGoHolderWords(dutyOf("implements", "Implements", "developer", null), roles)).toBe(
      "Jim · Developer held it and was let go; it goes back to them if they are hired back.",
    );
    expect(letGoHolderWords(dutyOf("implements", "Implements", null, null), roles)).toBeUndefined();
    expect(letGoHolderWords(dutyOf("plans", "Plans", "planner", PLANNER), roles)).toBeUndefined();
    expect(letGoHolderWords(dutyOf("plans", "Plans", "cto", null), roles)).toBeUndefined();
  });

  it("says a Consultant duty's holder is passed over while their Consultant is off", () => {
    const roles = [PLANNER, DEVOPS];
    expect(passedOverWords(dutyOf("mcp-tool-consultant", "MCP", "devops", DEVOPS), roles)).toBe(
      "Dwight's Consultant is off, so they are passed over and you are asked.",
    );
    expect(
      passedOverWords(dutyOf("mcp-tool-consultant", "MCP", "planner", PLANNER), roles),
    ).toBeUndefined();
    expect(
      passedOverWords(dutyOf("onboards-projects", "Onboards", "devops", DEVOPS), roles),
    ).toBeUndefined();
  });
});
