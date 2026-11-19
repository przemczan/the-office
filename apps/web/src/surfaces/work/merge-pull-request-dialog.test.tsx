import type { PullRequest, PullRequestMergeMethods } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
  type Answers,
  type Sent,
} from "../../shell/page.fixtures.tsx";
import { ClosePullRequestDialog } from "./close-pull-request-dialog.tsx";
import { MergePullRequestDialog } from "./merge-pull-request-dialog.tsx";

const PULL_REQUEST: PullRequest = {
  id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  projectId: "admin-panel",
  taskId: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  number: 12,
  url: "https://github.com/ada/admin-panel/pull/12",
  title: "Remember the sort",
  branch: "office/6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  baseBranch: "main",
  openedAt: "2026-11-10T10:00:00.000Z",
  checks: "passing",
  mergeable: "yes",
  checkedAt: "2026-11-10T10:05:00.000Z",
  stale: false,
};

const METHODS = `GET /api/pull-requests/${PULL_REQUEST.id}/merge-methods`;
const MERGE = `POST /api/pull-requests/${PULL_REQUEST.id}/merge`;
const CLOSE = `POST /api/pull-requests/${PULL_REQUEST.id}/close`;

let sent: Sent[] = [];

function methods(fields: Partial<PullRequestMergeMethods> = {}): PullRequestMergeMethods {
  return {
    allowed: ["merge", "squash"],
    recommended: "squash",
    warning: null,
    deletesBranchOnMerge: null,
    ...fields,
  };
}

async function openMerge(
  answers: Answers,
  pullRequest: PullRequest = PULL_REQUEST,
): Promise<HTMLElement> {
  sent = stubService(answers);
  await openPage("/", {
    "/": () => <MergePullRequestDialog pullRequest={pullRequest} onClose={() => {}} />,
  });
  return document.body;
}

function options(): string[] {
  return [...document.body.querySelectorAll('[role="radiogroup"] label')].map(
    (label) => label.textContent,
  );
}

function picked(): string | undefined {
  return (
    document.body.querySelector('[role="radio"][aria-checked="true"]')?.closest("label")
      ?.textContent ?? undefined
  );
}

afterEach(closePage);

describe("the Merge window", () => {
  it("offers only the allowed methods, the recommended one picked, and merges by the one picked", async () => {
    const page = await openMerge({
      [METHODS]: () => ({ status: 200, body: methods() }),
      [MERGE]: () => ({ status: 204 }),
    });

    await until(() => expect(options()).toEqual(["Create a merge commit", "Squash and merge"]));
    expect(picked()).toBe("Squash and merge");
    expect(page.textContent).toContain("Merge #12 Remember the sort");
    expect(page.textContent).toContain("Passing");
    expect(page.textContent).toContain("Can merge");
    expect(page.textContent).not.toContain("Checks are failing");

    act(() => buttonNamed(page, "Merge pull request")?.click());
    await until(() =>
      expect(sent.find(({ request }) => request === MERGE)?.body).toEqual({ method: "squash" }),
    );
  });

  it("shows the warning, and a caution when checks fail or it conflicts", async () => {
    const page = await openMerge(
      {
        [METHODS]: () => ({
          status: 200,
          body: methods({
            recommended: "merge",
            warning: "Squash would rewrite the Initiative's commits.",
          }),
        }),
      },
      { ...PULL_REQUEST, checks: "failing", mergeable: "conflicts" },
    );

    await until(() =>
      expect(page.textContent).toContain("Squash would rewrite the Initiative's commits."),
    );
    expect(picked()).toBe("Create a merge commit");
    expect(page.textContent).toContain("Checks are failing and it has conflicts");
    expect(page.textContent).toContain("Failing");
    expect(page.textContent).toContain("Conflicts");
    // A caution, not a block.
    expect(buttonNamed(page, "Merge pull request")?.disabled).toBe(false);
  });

  it.each([
    [true, "GitHub deletes the branch once it is merged."],
    [false, "The branch stays after the merge."],
    [null, "The Office doesn't delete the branch"],
  ])("says what happens to the branch when GitHub says %s", async (deletes, words) => {
    const page = await openMerge({
      [METHODS]: () => ({ status: 200, body: methods({ deletesBranchOnMerge: deletes }) }),
    });

    await until(() => expect(page.textContent).toContain(words));
  });

  it("shows a refusal in GitHub's words, with Refresh when the pull request changed", async () => {
    const page = await openMerge({
      [METHODS]: () => ({ status: 200, body: methods() }),
      [MERGE]: () => ({
        status: 409,
        body: { reason: "GitHub refused: Head branch was modified.", refresh: true },
      }),
      "POST /api/pull-requests/refresh": () => ({ status: 202 }),
    });

    await until(() => expect(picked()).toBe("Squash and merge"));
    act(() => buttonNamed(page, "Merge pull request")?.click());
    await until(() => expect(page.textContent).toContain("The pull request wasn't merged"));
    expect(page.textContent).toContain("GitHub refused: Head branch was modified.");

    act(() => buttonNamed(page, "Refresh")?.click());
    await until(() =>
      expect(sent.map(({ request }) => request)).toContain("POST /api/pull-requests/refresh"),
    );
  });

  it("offers no Refresh when the refusal isn't about the pull request having changed", async () => {
    const page = await openMerge({
      [METHODS]: () => ({ status: 200, body: methods() }),
      [MERGE]: () => ({ status: 409, body: { reason: "Required checks failed.", refresh: false } }),
    });

    await until(() => expect(picked()).toBe("Squash and merge"));
    act(() => buttonNamed(page, "Merge pull request")?.click());
    await until(() => expect(page.textContent).toContain("Required checks failed."));
    expect(buttonNamed(page, "Refresh")).toBeUndefined();
  });
});

describe("the Close window", () => {
  it("asks first, closes, and shows a refusal in GitHub's words", async () => {
    sent = stubService({
      [CLOSE]: () => ({ status: 409, body: { reason: "It is already merged.", refresh: true } }),
    });
    await openPage("/", {
      "/": () => <ClosePullRequestDialog pullRequest={PULL_REQUEST} onClose={() => {}} />,
    });
    const page = document.body;

    expect(page.textContent).toContain(
      "Close #12 without merging? The branch stays, and it can be reopened on GitHub.",
    );
    act(() => buttonNamed(page, "Close pull request")?.click());
    await until(() => expect(page.textContent).toContain("It is already merged."));
    expect(sent.map(({ request }) => request)).toContain(CLOSE);
    expect(buttonNamed(page, "Refresh")).toBeDefined();
  });
});
