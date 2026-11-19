import type { PullRequestEnd } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { closePage, openPage, stubService, until } from "../../shell/page.fixtures.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { pullRequestAction } from "./pull-request-button.tsx";
import { RecordActionButton } from "./record-actions.tsx";

// jsdom has no layout, so the tooltip, placed by its size, never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const AT = "2026-11-19T14:02:00.000Z";

const MERGED_BY_ANN: PullRequestEnd = {
  outcome: "merged",
  number: 12,
  url: "https://github.com/ada/admin-panel/pull/12",
  at: AT,
  method: "squash",
  by: { kind: "user", user: { userId: "ann", name: "Ann Lee" } },
};

const CLOSED_ON_GITHUB: PullRequestEnd = {
  ...MERGED_BY_ANN,
  outcome: "closed",
  method: null,
  by: { kind: "code-host", name: "GitHub" },
};

async function showHead(end: PullRequestEnd | null): Promise<HTMLElement> {
  stubService({ "GET /api/roles": () => ({ status: 200, body: [] }) });
  const action = pullRequestAction([], end);
  const { page } = await openPage("/", {
    "/": () => action && <RecordActionButton action={action} />,
  });
  return page;
}

async function hoverWords(page: HTMLElement): Promise<string | null | undefined> {
  act(() => {
    page
      .querySelector(".tooltip-trigger")
      ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  await until(() => expect(document.querySelector('[role="tooltip"]')).not.toBeNull());
  return document.querySelector('[role="tooltip"]')?.textContent;
}

afterEach(closePage);

describe("how the Task's pull request ended, beside Open pull request", () => {
  it("says it was merged, how, by whom and when, in the user's own time", async () => {
    const page = await showHead(MERGED_BY_ANN);

    await until(() => expect(page.textContent).toContain("Pull request merged"));
    expect(page.querySelector("a")?.getAttribute("href")).toBe(MERGED_BY_ANN.url);
    expect(page.textContent).toContain("Open pull request");
    expect(await hoverWords(page)).toBe(`#12 merged (squash) by Ann Lee, ${dayAndClockOf(AT)}`);
  });

  it("says it was closed on GitHub", async () => {
    const page = await showHead(CLOSED_ON_GITHUB);

    await until(() => expect(page.textContent).toContain("Pull request closed"));
    expect(await hoverWords(page)).toBe(`#12 closed on GitHub, ${dayAndClockOf(AT)}`);
  });

  it("isn't there while no pull request was opened or ended", () => {
    expect(pullRequestAction([], null)).toBeUndefined();
  });
});
