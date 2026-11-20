import { describe, expect, it } from "vitest";
import type { Role } from "@the-office/contracts";
import { BY_ANN, BY_YOU, SIGNED_IN } from "../user.fixtures.ts";
import {
  authorName,
  BUG_DESCRIPTION_OUTLINE,
  BUG_OUTLINE_CURSOR,
  descriptionForKind,
  reportedMetCount,
  taskStateWords,
} from "./work-words.ts";

describe("taskStateWords", () => {
  it("reads a Paused Task by what holds it", () => {
    expect(taskStateWords("paused")).toBe("Paused");
    expect(taskStateWords("paused", { stopped: true })).toBe("Stopped");
    expect(taskStateWords("paused", { pausedBy: "alarm" })).toBe("Paused by the alarm");
  });

  it("gives the alarm's words over a Stop", () => {
    expect(taskStateWords("paused", { pausedBy: "alarm", stopped: true })).toBe(
      "Paused by the alarm",
    );
  });

  it("names any other state as it is, whatever its Stage last did", () => {
    expect(taskStateWords("in-progress", { stopped: true })).toBe("In progress");
    expect(taskStateWords("dropped", { stopped: true })).toBe("Dropped");
    expect(taskStateWords("waiting-on-you", { pausedBy: "alarm" })).toBe("Waiting on you");
  });
});

describe("reportedMetCount", () => {
  it("counts only the numbers that are statements", () => {
    expect(reportedMetCount(["One.", "Two."], [2, 5])).toBe(1);
  });
});

describe("authorName", () => {
  const roles = [{ key: "cto", card: { name: "Grace" } }] as unknown as Role[];

  it("names the signed-in user You, another user by name, and a person by first name", () => {
    expect(authorName({ kind: "user", user: BY_YOU }, roles, SIGNED_IN.id)).toBe("You");
    expect(authorName({ kind: "user", user: BY_ANN }, roles, SIGNED_IN.id)).toBe("Ann Lee");
    expect(authorName({ kind: "person", roleKey: "cto" }, roles, SIGNED_IN.id)).toBe("Grace");
  });

  it("keeps You on a record from before users existed", () => {
    expect(authorName({ kind: "user", user: null }, roles, SIGNED_IN.id)).toBe("You");
  });
});

describe("descriptionForKind", () => {
  it("fills the Bug outline into an empty Description as Bug is chosen", () => {
    expect(descriptionForKind("", "feature", "bug")).toBe(BUG_DESCRIPTION_OUTLINE);
    expect(descriptionForKind("  ", "chore", "bug")).toBe(BUG_DESCRIPTION_OUTLINE);
  });

  it("empties the untouched outline as Bug is left, and keeps one edited", () => {
    expect(descriptionForKind(BUG_DESCRIPTION_OUTLINE, "bug", "feature")).toBe("");
    const edited = `${BUG_DESCRIPTION_OUTLINE}Signed out.`;
    expect(descriptionForKind(edited, "bug", "chore")).toBe(edited);
  });

  it("never touches the user's own words", () => {
    expect(descriptionForKind("It fails.", "feature", "bug")).toBe("It fails.");
  });

  it("puts the cursor at the end of the outline's first step", () => {
    expect(BUG_DESCRIPTION_OUTLINE.slice(0, BUG_OUTLINE_CURSOR).endsWith("1. ")).toBe(true);
  });
});
