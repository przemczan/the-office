import type { Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  emptyInitiativeTabWords,
  firstInitiativeTab,
  initiativeTabAsked,
  initiativeTabLine,
  initiativeTabs,
  threadAsked,
  unfilledRoleName,
} from "./initiative-conversation-tabs.ts";

function aThread(id: string, roleKey: string, startedAt: string): Thread {
  return { id, roleKey, startedAt } as Thread;
}

const shaping = aThread("shaping", "cto", "2026-11-04T09:00:00.000Z");
const pricing = aThread("pricing", "cto", "2026-11-03T09:00:00.000Z");
const planning = aThread("planning", "planner", "2026-11-05T09:00:00.000Z");
const consultation = aThread("consultation", "reviewer", "2026-11-05T10:00:00.000Z");

describe("initiativeTabs", () => {
  it("always has the CTO's and the Planner's tabs, the CTO first, with no Thread yet", () => {
    expect(initiativeTabs([])).toEqual([
      { roleKey: "cto", threads: [] },
      { roleKey: "planner", threads: [] },
    ]);
  });

  it("adds anyone else with a Thread after them, each tab's Threads the oldest first", () => {
    const tabs = initiativeTabs([consultation, planning, shaping, pricing]);
    expect(tabs.map(({ roleKey, threads }) => [roleKey, threads.map(({ id }) => id)])).toEqual([
      ["cto", ["pricing", "shaping"]],
      ["planner", ["planning"]],
      ["reviewer", ["consultation"]],
    ]);
  });
});

describe("firstInitiativeTab", () => {
  it("opens on the person with the newest Thread", () => {
    expect(firstInitiativeTab(initiativeTabs([shaping, planning]))).toBe("planner");
    expect(firstInitiativeTab(initiativeTabs([shaping, pricing]))).toBe("cto");
  });

  it("opens on the CTO while nobody has a Thread", () => {
    expect(firstInitiativeTab(initiativeTabs([]))).toBe("cto");
  });
});

describe("the tab the address names", () => {
  const tabs = initiativeTabs([shaping, pricing, planning]);

  it("goes by the person's key or by any of their Threads", () => {
    expect(initiativeTabAsked("planner", tabs)).toBe("planner");
    expect(initiativeTabAsked("pricing", tabs)).toBe("cto");
    expect(initiativeTabAsked(undefined, tabs)).toBeUndefined();
    expect(initiativeTabAsked("gone", tabs)).toBeUndefined();
  });

  it("names a Thread only when it is the tab's", () => {
    const [cto] = tabs;
    if (!cto) throw new Error("The CTO's tab is missing.");
    expect(threadAsked("pricing", cto)).toBe("pricing");
    expect(threadAsked("planning", cto)).toBeUndefined();
    expect(threadAsked("cto", cto)).toBeUndefined();
  });
});

function empty(roleKey: string, personName: string | undefined): string {
  return emptyInitiativeTabWords({ roleKey, personName, initiativeName: "Exports", ended: false });
}

describe("a tab's words", () => {
  it("says what the CTO and the Planner do here", () => {
    expect(initiativeTabLine("cto")).toBe("Shapes the outcome and the Tasks with you");
    expect(initiativeTabLine("planner")).toBe("Plans the Initiative's Tasks");
  });

  it("names a Role nobody fills by what it is", () => {
    expect(unfilledRoleName("cto")).toBe("CTO");
    expect(unfilledRoleName("planner")).toBe("Planner");
  });

  it("says where an empty tab's first Thread starts, or who must be hired", () => {
    expect(empty("cto", "Bob")).toBe("No conversation with Bob on Exports yet.");
    expect(empty("cto", undefined)).toBe(
      "No conversation on Exports yet. Hire a CTO to shape it with them.",
    );
    expect(empty("planner", "Jan")).toBe(
      "No planning on Exports yet. Once it is active with a Task in Backlog, Plan the Initiative starts it with Jan.",
    );
    expect(empty("planner", undefined)).toBe(
      "No planning on Exports yet. Hire a Planner to plan its Tasks.",
    );
  });

  it("says only that there was no conversation once the Initiative has ended", () => {
    expect(
      emptyInitiativeTabWords({
        roleKey: "planner",
        personName: "Jan",
        initiativeName: "Exports",
        ended: true,
      }),
    ).toBe("No conversation with Jan on Exports.");
  });
});
