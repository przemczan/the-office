import type { Project, Role } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  aboutLine,
  personOf,
  targetOf,
  titleWithUnread,
  unreadCount,
} from "./notification-words.ts";

const TASK_ID = "6820f3e0-132c-414a-9d26-ed497c7ea9bf";

describe("targetOf", () => {
  it("opens the Task a Decision, a Gate or an outcome is about, and Now for the Office", () => {
    expect(targetOf({ kind: "decision", decisionId: TASK_ID, taskId: TASK_ID })).toEqual({
      to: "/tasks/$taskId",
      params: { taskId: TASK_ID },
    });
    expect(targetOf({ kind: "office" })).toEqual({ to: "/now" });
  });
});

describe("titleWithUnread", () => {
  it("counts the open Notifications in the tab's title", () => {
    expect(titleWithUnread(0)).toBe("The Office");
    expect(titleWithUnread(3)).toBe("(3) The Office");
  });
});

describe("personOf", () => {
  it("is the person who speaks, and nobody when The Office does", () => {
    const roles = [{ key: "developer", card: { name: "Adam" } }] as unknown as Role[];

    expect(personOf({ roleKey: "developer" }, roles)).toBe("Adam");
    expect(personOf({ roleKey: null }, roles)).toBeUndefined();
  });
});

describe("aboutLine", () => {
  it("names the Task and its Project", () => {
    const projects = [{ id: "p1", name: "Billing" }] as unknown as Project[];

    expect(aboutLine({ title: "Add a filter", projectId: "p1" }, projects)).toBe(
      "Add a filter · Billing",
    );
    expect(aboutLine(undefined, projects)).toBeUndefined();
  });
});

describe("unreadCount", () => {
  it("counts what goes in-app", () => {
    expect(
      unreadCount([
        { channels: ["in-app", "desktop"] },
        { channels: ["desktop"] },
        { channels: [] },
      ]),
    ).toBe(1);
  });
});
