import type { OpenIssue, Project } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
} from "../../../shell/page.fixtures.tsx";
import { GitHubIssuesBlock } from "./github-issues-block.tsx";

const SETTINGS = {
  autoImportLabel: null,
  closeOnDone: true,
  commentOnStartAndDone: false,
  closeOnDrop: false,
};

const PROJECT = {
  id: "the-office",
  name: "the-office",
  issueSettings: SETTINGS,
} as unknown as Project;

const ISSUES: readonly OpenIssue[] = [
  {
    number: 418,
    title: "Live view freezes after the laptop wakes up",
    url: "https://github.com/ptelazka/the-office/issues/418",
    author: { login: "octocat", url: "https://github.com/octocat" },
    labels: ["bug", "live-view"],
    openedAt: "2026-11-20T08:00:00.000Z",
    kind: "bug",
  },
  {
    number: 415,
    title: "Export Stats as CSV",
    url: "https://github.com/ptelazka/the-office/issues/415",
    author: { login: "hubot", url: "https://github.com/hubot" },
    labels: ["enhancement"],
    openedAt: "2026-11-01T08:00:00.000Z",
    kind: "feature",
  },
  {
    number: 412,
    title: "Login fails after a password reset",
    url: "https://github.com/ptelazka/the-office/issues/412",
    author: { login: "octocat", url: "https://github.com/octocat" },
    labels: [],
    openedAt: "2026-10-01T08:00:00.000Z",
    kind: "feature",
  },
];

/** Built, as a literal "#" and three digits reads to the lint as a colour. */
const ALREADY_IMPORTED = `#${412} was already imported.`;
const ISSUES_PATH = "GET /api/projects/the-office/issues";
const SETTINGS_PATH = "PUT /api/projects/the-office/issue-settings";
const pages = { "/": () => <GitHubIssuesBlock project={PROJECT} /> };

afterEach(closePage);

function refused(message: string): { status: number; body: unknown } {
  return { status: 422, body: { statusCode: 422, message, reasons: [message] } };
}

function switchIn(scope: ParentNode, group: string): HTMLElement {
  const found = scope.querySelector(`[role="group"][aria-label="${group}"] [role="switch"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`No switch in ${group}.`);
  return found;
}

function issueRow(number: number): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('li[role="group"]')].find((row) =>
    row.getAttribute("aria-label")?.startsWith(`#${number} `),
  );
  if (!found) throw new Error(`No row for #${number}.`);
  return found;
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the GitHub issues block", () => {
  it("names the repository and its open issues, and saves a write-back switch at once", async () => {
    const sent = stubService({
      [ISSUES_PATH]: () => ({ status: 200, body: ISSUES }),
      [SETTINGS_PATH]: (body) => ({
        status: 200,
        body: { ...PROJECT, issueSettings: body },
      }),
    });
    const { page } = await openPage("/", pages);
    await until(() =>
      expect(page.textContent).toContain("ptelazka/the-office · 3 open issues not yet imported"),
    );
    expect(page.textContent).toContain("Signed in with GitHub");
    expect(switchIn(page, "Close the issue when the Task is Done").ariaChecked).toBe("true");

    act(() => switchIn(page, "Comment when the Task starts and when it is Done").click());

    await until(() =>
      expect(sent.find(({ request }) => request === SETTINGS_PATH)?.body).toEqual({
        ...SETTINGS,
        commentOnStartAndDone: true,
      }),
    );
  });

  it("asks for a label before turning the auto-import on, then saves it", async () => {
    const sent = stubService({
      [ISSUES_PATH]: () => ({ status: 200, body: ISSUES }),
      [SETTINGS_PATH]: (body) => ({ status: 200, body: { ...PROJECT, issueSettings: body } }),
    });
    const { page } = await openPage("/", pages);
    const autoImport = "Auto-import issues with a label";

    act(() => switchIn(page, autoImport).click());
    expect(page.textContent).toContain("Name the label first.");
    expect(sent.some(({ request }) => request === SETTINGS_PATH)).toBe(false);

    const label = page.querySelector<HTMLInputElement>('input[aria-label="Label"]');
    if (!label) throw new Error("No label field.");
    typeInto(label, "office");
    act(() => switchIn(page, autoImport).click());

    await until(() =>
      expect(sent.find(({ request }) => request === SETTINGS_PATH)?.body).toEqual({
        ...SETTINGS,
        autoImportLabel: "office",
      }),
    );
    expect(page.textContent).not.toContain("Name the label first.");
  });

  it("says why a repository not on GitHub has no issues, in place of the switches", async () => {
    const words = "GitHub issues need a repository on GitHub. This Project's is at gitlab.com.";
    stubService({ [ISSUES_PATH]: () => refused(words) });
    const { page } = await openPage("/", pages);

    await until(() => expect(page.textContent).toContain(words));
    expect(page.querySelector('[role="switch"]')).toBeNull();
    expect(buttonNamed(page, "Import issues…")).toBeUndefined();
  });

  it("sends the user to sign in, and keeps the switches", async () => {
    stubService({
      [ISSUES_PATH]: () =>
        refused("Sign in with GitHub in Settings › Office identity to import issues."),
    });
    const { page } = await openPage("/", pages);

    await until(() =>
      expect(page.textContent).toContain(
        "Sign in with GitHub in Settings › Office identity to import issues.",
      ),
    );
    expect(page.querySelector('a[href="/settings/office-identity"]')).not.toBeNull();
    expect(page.querySelectorAll('[role="switch"]')).toHaveLength(4);
  });

  it("imports the issues picked in its window, previewing each one's Kind", async () => {
    const sent = stubService({
      [ISSUES_PATH]: () => ({ status: 200, body: ISSUES }),
      "POST /api/projects/the-office/issues/import": () => ({
        status: 200,
        body: {
          imported: [{ number: 418, taskId: "6f1c2a52-58a4-4a54-9d55-0e8a63f1c001" }],
          skipped: [{ number: 412, why: ALREADY_IMPORTED }],
        },
      }),
    });
    const { page } = await openPage("/", pages);
    await until(() => expect(page.textContent).toContain("Signed in with GitHub"));

    act(() => buttonNamed(page, "Import issues…")?.click());
    const window = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!window) throw new Error("Import issues didn't open.");
    expect(issueRow(418).textContent).toContain("Bug");
    expect(issueRow(415).textContent).toContain("Feature");
    expect(buttonNamed(window, "Import issues")?.disabled).toBe(true);

    act(() => issueRow(418).click());
    act(() => issueRow(412).click());
    expect(window.textContent).toContain("2 picked");

    const search = window.querySelector<HTMLInputElement>('input[aria-label="Search the issues"]');
    if (!search) throw new Error("No search.");
    typeInto(search, "csv");
    expect(window.querySelectorAll('li[role="group"]')).toHaveLength(1);

    act(() => buttonNamed(window, "Import 2 issues")?.click());

    await until(() =>
      expect(document.body.textContent).toContain(`1 Task added to Backlog. ${ALREADY_IMPORTED}`),
    );
    expect(
      sent.find(({ request }) => request === "POST /api/projects/the-office/issues/import")?.body,
    ).toEqual({ numbers: [418, 412] });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
