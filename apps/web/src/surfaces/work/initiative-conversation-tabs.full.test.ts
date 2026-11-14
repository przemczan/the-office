import type { Role, Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import type { DutyHolder } from "../../shell/use-duty-holder.ts";
import {
  emptyInitiativeTabWords,
  firstInitiativeTab,
  initiativeTabAsked,
  initiativeTabLine,
  initiativeTabs,
  threadAsked,
  unfilledTabName,
} from "./initiative-conversation-tabs.ts";

function aThread(id: string, roleKey: string, startedAt: string): Thread {
  return { id, roleKey, startedAt } as Thread;
}

function heldBy(key: string, label: string): DutyHolder {
  return { holder: { key, letGoAt: null } as Role, label, fallback: undefined };
}

function unheld(label: string): DutyHolder {
  return { holder: undefined, label, fallback: "user" };
}

const holders = {
  shaper: heldBy("cto", "Shapes Initiatives"),
  planner: heldBy("planner", "Plans"),
};

const shaping = aThread("shaping", "cto", "2026-11-04T09:00:00.000Z");
const pricing = aThread("pricing", "cto", "2026-11-03T09:00:00.000Z");
const planning = aThread("planning", "planner", "2026-11-05T09:00:00.000Z");
const consultation = aThread("consultation", "reviewer", "2026-11-05T10:00:00.000Z");

describe("initiativeTabs", () => {
  it("always has the shaper's and the planner's tabs, the shaper first, with no Thread yet", () => {
    expect(initiativeTabs([], holders)).toEqual([
      { roleKey: "cto", duties: ["shapes-initiatives"], unheldLabel: undefined, threads: [] },
      { roleKey: "planner", duties: ["plans"], unheldLabel: undefined, threads: [] },
    ]);
  });

  it("adds anyone else with a Thread after them, each tab's Threads the oldest first", () => {
    const tabs = initiativeTabs([consultation, planning, shaping, pricing], holders);
    expect(tabs.map(({ roleKey, threads }) => [roleKey, threads.map(({ id }) => id)])).toEqual([
      ["cto", ["pricing", "shaping"]],
      ["planner", ["planning"]],
      ["reviewer", ["consultation"]],
    ]);
    expect(tabs[2]?.duties).toEqual([]);
  });

  it("keys the tabs by whoever holds the duties, whatever their Role key", () => {
    const tabs = initiativeTabs([aThread("a", "architect", "2026-11-04T09:00:00.000Z")], {
      shaper: heldBy("architect", "Shapes Initiatives"),
      planner: heldBy("lead", "Plans"),
    });
    expect(tabs.map(({ roleKey, duties, threads }) => [roleKey, duties, threads.length])).toEqual([
      ["architect", ["shapes-initiatives"], 1],
      ["lead", ["plans"], 0],
    ]);
    expect(tabs.map(initiativeTabLine)).toEqual([
      "Shapes the outcome and the Tasks with you",
      "Plans the Initiative's Tasks",
    ]);
  });

  it("has one tab, pinned for both duties, when one Role holds both", () => {
    const tabs = initiativeTabs([], {
      shaper: heldBy("architect", "Shapes Initiatives"),
      planner: heldBy("architect", "Plans"),
    });
    expect(tabs).toEqual([
      {
        roleKey: "architect",
        duties: ["shapes-initiatives", "plans"],
        unheldLabel: undefined,
        threads: [],
      },
    ]);
    expect(initiativeTabLine(tabs[0] ?? { duties: [] })).toBe(
      "Shapes the outcome and the Tasks with you, and plans them",
    );
  });

  it("holds a duty's place by its label while nobody holds it", () => {
    const tabs = initiativeTabs([], {
      shaper: heldBy("architect", "Shapes Initiatives"),
      planner: unheld("Plans"),
    });
    expect(tabs[1]).toEqual({
      roleKey: "plans",
      duties: ["plans"],
      unheldLabel: "Plans",
      threads: [],
    });
    expect(unfilledTabName(tabs[1] ?? { roleKey: "", unheldLabel: undefined })).toBe("Plans");
  });

  it("keeps a former holder's Threads on their own tab", () => {
    const tabs = initiativeTabs([shaping, planning], {
      shaper: heldBy("architect", "Shapes Initiatives"),
      planner: heldBy("lead", "Plans"),
    });
    expect(
      tabs.map(({ roleKey, duties, threads }) => [roleKey, duties, threads.map(({ id }) => id)]),
    ).toEqual([
      ["architect", ["shapes-initiatives"], []],
      ["lead", ["plans"], []],
      ["cto", [], ["shaping"]],
      ["planner", [], ["planning"]],
    ]);
    expect(initiativeTabLine(tabs[2] ?? { duties: [] })).toBe("Talks with you on this Initiative");
  });
});

describe("firstInitiativeTab", () => {
  it("opens on the person with the newest Thread", () => {
    expect(firstInitiativeTab(initiativeTabs([shaping, planning], holders))).toBe("planner");
    expect(firstInitiativeTab(initiativeTabs([shaping, pricing], holders))).toBe("cto");
  });

  it("opens on the shaper while nobody has a Thread", () => {
    expect(firstInitiativeTab(initiativeTabs([], holders))).toBe("cto");
  });
});

describe("the tab the address names", () => {
  const tabs = initiativeTabs([shaping, pricing, planning], holders);

  it("goes by the person's key or by any of their Threads", () => {
    expect(initiativeTabAsked("planner", tabs)).toBe("planner");
    expect(initiativeTabAsked("pricing", tabs)).toBe("cto");
    expect(initiativeTabAsked(undefined, tabs)).toBeUndefined();
    expect(initiativeTabAsked("gone", tabs)).toBeUndefined();
  });

  it("names a Thread only when it is the tab's", () => {
    const [cto] = tabs;
    if (!cto) throw new Error("The shaper's tab is missing.");
    expect(threadAsked("pricing", cto)).toBe("pricing");
    expect(threadAsked("planning", cto)).toBeUndefined();
    expect(threadAsked("cto", cto)).toBeUndefined();
  });
});

const shaperTab = {
  roleKey: "cto",
  duties: ["shapes-initiatives"],
  unheldLabel: undefined,
} as const;
const plannerTab = { roleKey: "planner", duties: ["plans"], unheldLabel: undefined } as const;
const unheldShaping = {
  roleKey: "shapes-initiatives",
  duties: ["shapes-initiatives"],
  unheldLabel: "Shapes Initiatives",
} as const;
const unheldPlanning = { roleKey: "plans", duties: ["plans"], unheldLabel: "Plans" } as const;

function empty(
  tab: Parameters<typeof emptyInitiativeTabWords>[0]["tab"],
  personName: string | undefined,
): string {
  return emptyInitiativeTabWords({ tab, personName, initiativeName: "Exports", ended: false });
}

describe("a tab's words", () => {
  it("says what the shaper and the planner do here", () => {
    expect(initiativeTabLine(shaperTab)).toBe("Shapes the outcome and the Tasks with you");
    expect(initiativeTabLine(plannerTab)).toBe("Plans the Initiative's Tasks");
  });

  it("names a duty nobody holds by its label, else by the Role's key", () => {
    expect(unfilledTabName(unheldPlanning)).toBe("Plans");
    expect(unfilledTabName({ roleKey: "reviewer", unheldLabel: undefined })).toBe("reviewer");
  });

  it("says where an empty tab's first Thread starts, or which duty nobody holds", () => {
    expect(empty(shaperTab, "Bob")).toBe("No conversation with Bob on Exports yet.");
    expect(empty(unheldShaping, undefined)).toBe(
      "No conversation on Exports yet: nobody holds Shapes Initiatives.",
    );
    expect(empty(plannerTab, "Jan")).toBe(
      "No planning on Exports yet. Once it is active with a Task in Backlog, Plan the Initiative starts it with Jan.",
    );
    expect(empty(unheldPlanning, undefined)).toBe(
      "No planning on Exports yet: nobody holds Plans.",
    );
  });

  it("says only that there was no conversation once the Initiative has ended", () => {
    expect(
      emptyInitiativeTabWords({
        tab: plannerTab,
        personName: "Jan",
        initiativeName: "Exports",
        ended: true,
      }),
    ).toBe("No conversation with Jan on Exports.");
  });
});
