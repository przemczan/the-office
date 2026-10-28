import type { Project, Role } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  aboutLine,
  personOf,
  serviceDown,
  targetOf,
  titleWithUnread,
  unreadCount,
} from "./notification-words.ts";

const TASK_ID = "6820f3e0-132c-414a-9d26-ed497c7ea9bf";

describe("targetOf", () => {
  it("opens the Task or Initiative a Notification is about, and Now for the Office", () => {
    expect(
      targetOf({
        pointsTo: { kind: "decision", decisionId: TASK_ID, taskId: TASK_ID },
        roleKey: "developer",
      }),
    ).toEqual({ to: "/tasks/$taskId", params: { taskId: TASK_ID } });
    expect(
      targetOf({ pointsTo: { kind: "initiative", initiativeId: TASK_ID }, roleKey: null }),
    ).toEqual({ to: "/work/initiatives/$initiativeId", params: { initiativeId: TASK_ID } });
    expect(targetOf({ pointsTo: { kind: "office" }, roleKey: null })).toEqual({ to: "/now" });
  });

  it("opens the Office Manager's chat over Now when they speak an Office kind", () => {
    expect(targetOf({ pointsTo: { kind: "office" }, roleKey: "office-manager" })).toEqual({
      to: "/now",
      search: { chat: "office-manager" },
    });
  });
});

function officeManager(letGoAt: string | null): Role[] {
  return [{ key: "office-manager", letGoAt, card: { name: "Marta" } }] as unknown as Role[];
}

describe("serviceDown", () => {
  it("comes from the Office Manager while one is hired, and in the UI's voice otherwise", () => {
    expect(serviceDown(officeManager(null))).toMatchObject({
      roleKey: "office-manager",
      line: "I lost touch with the service and am reconnecting.",
      channels: ["in-app", "desktop"],
    });
    expect(serviceDown(officeManager("2026-10-27T09:00:00.000Z"))).toMatchObject({
      roleKey: null,
      line: "The Office lost its service and is reconnecting.",
    });
    expect(serviceDown(undefined).roleKey).toBeNull();
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
