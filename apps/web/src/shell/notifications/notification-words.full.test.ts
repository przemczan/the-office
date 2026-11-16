import type { Duty, Project, Role } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  aboutLine,
  blinkingTabTitle,
  namedTimeWords,
  notificationLineOf,
  personOf,
  serviceDown,
  tabTitle,
  targetOf,
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

  it("opens the chat of whoever speaks an Office kind over Now", () => {
    expect(targetOf({ pointsTo: { kind: "office" }, roleKey: "receptionist" })).toEqual({
      to: "/now",
      search: { chat: "receptionist" },
    });
  });
});

const ROLES = [
  { key: "caretaker", builtIn: true, letGoAt: null, card: { name: "Toby" } },
  { key: "receptionist", builtIn: false, letGoAt: null, card: { name: "Marta" } },
] as unknown as Role[];

/** Default person to talk to, held by the Role keyed `holder` or by nobody. */
function defaultPerson(holder: string | null): Duty[] {
  return [
    {
      key: "default-person-to-talk-to",
      label: "Default person to talk to",
      defaultRoleKey: "office-manager",
      set: true,
      roleKey: holder,
      holder: holder === null ? null : { roleKey: holder, name: "Marta", title: "Receptionist" },
      fallback: holder === null ? "caretaker" : null,
    },
  ];
}

describe("serviceDown", () => {
  it("comes from whoever holds Default person to talk to, whatever their Role's key", () => {
    expect(serviceDown(defaultPerson("receptionist"), ROLES, undefined)).toMatchObject({
      roleKey: "receptionist",
      line: "I lost touch with the service and am reconnecting.",
      channels: ["in-app", "desktop"],
    });
  });

  it("comes from the Caretaker while nobody holds it", () => {
    expect(serviceDown(defaultPerson(null), ROLES, undefined)).toMatchObject({
      roleKey: "caretaker",
      line: "I lost touch with the service and am reconnecting.",
    });
  });

  it("is in the UI's voice until the duties and the Roles were read", () => {
    expect(serviceDown(undefined, ROLES, undefined)).toMatchObject({
      roleKey: null,
      line: "The Office lost its service and is reconnecting.",
    });
    expect(serviceDown(defaultPerson("receptionist"), undefined, undefined).roleKey).toBeNull();
  });

  it("goes to the browser's channels the user's routing gives it, never the phone", () => {
    const off = { on: false, from: "office" };
    const on = { on: true, from: "office.down.service" };
    const routing = { "office.down.service": { "in-app": on, desktop: off, phone: on } };

    expect(serviceDown(undefined, undefined, routing).channels).toEqual(["in-app"]);
  });
});

describe("tabTitle", () => {
  it("counts Needs you in the tab's title", () => {
    expect(tabTitle(0)).toBe("The Office");
    expect(tabTitle(3)).toBe("(3) The Office");
  });
});

describe("blinkingTabTitle", () => {
  it("says how many need the user", () => {
    expect(blinkingTabTitle(1)).toBe("1 needs you");
    expect(blinkingTabTitle(3)).toBe("3 need you");
  });
});

describe("personOf", () => {
  it("is the person who speaks, and nobody when The Office does", () => {
    const roles = [{ key: "developer", card: { name: "Adam" } }] as unknown as Role[];

    expect(personOf({ roleKey: "developer" }, roles)).toEqual({
      roleKey: "developer",
      name: "Adam",
    });
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

describe("notificationLineOf", () => {
  // 16:10 UTC, 17:10 in Warsaw, on Tuesday 17 November 2026.
  const at = "2026-11-17T16:10:00.000Z";
  const line =
    "Claude Code's 5-hour window is used up until {time}. Tasks on it are paused and wait.";

  it("words the time a Notification names in the browser's time zone, by the clock on its day", () => {
    const sameDay = new Date("2026-11-17T08:00:00.000Z");
    expect(notificationLineOf(line, { at }, sameDay, "Europe/Warsaw")).toBe(
      "Claude Code's 5-hour window is used up until 17:10. Tasks on it are paused and wait.",
    );
    expect(notificationLineOf(line, { at }, sameDay, "UTC")).toContain("until 16:10.");
  });

  it("gives the day too when it is on another day there", () => {
    const dayBefore = new Date("2026-11-16T12:00:00.000Z");
    expect(namedTimeWords(at, dayBefore, "Europe/Warsaw")).toBe("Tue 17 Nov 17:10");
    // Past midnight in Tokyo, it is the next day there though the same in Warsaw.
    expect(namedTimeWords(at, new Date("2026-11-17T08:00:00.000Z"), "Asia/Tokyo")).toBe(
      "Wed 18 Nov 01:10",
    );
  });

  it("uses the browser's own time zone unless told another", () => {
    const local = new Date(at);
    const clock = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
    expect(namedTimeWords(at, local)).toBe(clock);
  });

  it("shows a line naming no time as stored, as one raised before Notifications kept it", () => {
    expect(notificationLineOf("Claude Code used up until 14:20", {})).toBe(
      "Claude Code used up until 14:20",
    );
  });
});
