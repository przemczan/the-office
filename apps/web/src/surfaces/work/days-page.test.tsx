import type { DaySummary } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
  type Sent,
} from "../../shell/page.fixtures.tsx";
import { DaysPage } from "./days-page.tsx";

const ID = "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const AT = "2026-11-26T10:00:00.000Z";

const SUMMARY: DaySummary = {
  day: "2026-11-26",
  today: "2026-11-27",
  initiativesDone: [],
  tasksDone: [
    {
      id: ID,
      title: "Remember the sort",
      projectId: "admin-panel",
      kind: "feature",
      pullRequestNumber: 7,
      at: AT,
    },
  ],
  pullRequestsMerged: [
    {
      taskId: ID,
      title: "Remember the sort",
      projectId: "admin-panel",
      number: 7,
      url: "https://github.com/acme/admin/pull/7",
      by: { kind: "code-host", name: "GitHub" },
      at: AT,
    },
  ],
  failedOrDropped: [
    {
      outcome: "dropped",
      taskId: ID,
      title: "Old idea",
      projectId: "admin-panel",
      stageName: null,
      dropReason: { kind: "wont-fix" },
      at: AT,
    },
  ],
  ideasCaptured: [{ id: ID, title: "A thought", projectId: null, at: AT }],
  tasksStarted: [],
  // Cache reads are left out of the count.
  tokens: { input: 1_000_000, output: 2_000_000, cacheCreation: 400_000, cacheRead: 9_000_000_000 },
  elsewhere: 0,
};

let sent: Sent[] = [];

let location: () => string;

async function open(path: string, summary: DaySummary): Promise<HTMLElement> {
  sent = stubService({
    "GET /api/days/today": () => ({ status: 200, body: summary }),
    "GET /api/days/2026-11-26": () => ({ status: 200, body: summary }),
    "GET /api/days/2026-11-25": () => ({ status: 200, body: { ...summary, day: "2026-11-25" } }),
    "GET /api/projects": () => ({ status: 200, body: [] }),
    "GET /api/roles": () => ({ status: 200, body: [] }),
  });
  const { page, router } = await openPage(path, { "/work/days": DaysPage });
  location = () => router.state.location.href;
  return page;
}

afterEach(closePage);

describe("Work › Days", () => {
  it("asks for today when no day is in the address, and words the counts and groups", async () => {
    const page = await open("/work/days", { ...SUMMARY, day: "2026-11-27" });
    await until(() => expect(page.textContent).toContain("Today, so far"));
    expect(sent.some(({ request }) => request === "GET /api/days/today")).toBe(true);
    expect(page.textContent).toContain("1 Task done · 1 pull request merged · 1 failed or dropped");
    expect(page.textContent).toContain("3.4M tokens");
    expect(page.textContent).toContain("Merged on GitHub");
    expect(page.textContent).toContain("Won't fix");
    expect(buttonNamed(page, "Next day")?.disabled).toBe(true);
  });

  it("asks for the day in the address and opens the also list", async () => {
    const page = await open("/work/days?day=2026-11-26", SUMMARY);
    await until(() => expect(page.textContent).toContain("Thursday 26 November 2026"));
    expect(sent.some(({ request }) => request === "GET /api/days/2026-11-26")).toBe(true);
    expect(buttonNamed(page, "Next day")?.disabled).toBe(false);
    act(() => buttonNamed(page, "1 Idea captured")?.click());
    expect(page.textContent).toContain("A thought");
  });

  it("writes a past day into the address, and leaves today out of it", async () => {
    const page = await open("/work/days?day=2026-11-26", SUMMARY);
    await until(() => expect(page.textContent).toContain("Thursday 26 November 2026"));
    await act(async () => buttonNamed(page, "Previous day")?.click());
    await until(() => expect(location()).toBe("/work/days?day=2026-11-25"));
    await act(async () => buttonNamed(page, "Today")?.click());
    await until(() => expect(location()).toBe("/work/days"));
  });

  it("says an empty day is empty", async () => {
    const page = await open("/work/days?day=2026-11-26", {
      ...SUMMARY,
      tasksDone: [],
      pullRequestsMerged: [],
      failedOrDropped: [],
      ideasCaptured: [],
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    });
    await until(() =>
      expect(page.textContent).toContain("Nothing was finished on Thursday 26 November 2026."),
    );
  });
});
