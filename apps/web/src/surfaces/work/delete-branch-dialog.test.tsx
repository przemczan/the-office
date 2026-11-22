import type { BranchDeletionPreview } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
  type Answers,
  type Sent,
} from "../../shell/page.fixtures.tsx";
import { DeleteBranchDialog } from "./delete-branch-dialog.tsx";

const TASK_ID = "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const INITIATIVE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const BRANCH = `office/${TASK_ID}`;
const PREVIEW = `GET /api/tasks/${TASK_ID}/branch-deletion`;
const DELETE = `POST /api/tasks/${TASK_ID}/branch-deletion`;

const SAFE: BranchDeletionPreview = {
  branch: BRANCH,
  baseBranch: "main",
  copies: [
    { kind: "local", name: BRANCH, commit: "a1" },
    { kind: "remote", name: `origin/${BRANCH}`, commit: "b2" },
  ],
  worktreePath: "/data/worktrees/admin-panel/6f1c2b3a",
  holdsWork: null,
  refusal: null,
};

let sent: Sent[] = [];
let closed = false;

async function opened(
  answers: Answers,
  owner: Parameters<typeof DeleteBranchDialog>[0]["owner"] = { kind: "task", taskId: TASK_ID },
  branch = BRANCH,
): Promise<HTMLElement> {
  sent = stubService(answers);
  closed = false;
  await openPage("/", {
    "/": () => (
      <DeleteBranchDialog
        owner={owner}
        branch={branch}
        onClose={() => {
          closed = true;
        }}
      />
    ),
  });
  return document.body;
}

afterEach(closePage);

describe("the Delete branch window", () => {
  it("checks the branch first, then lists what goes and deletes it when everything is in the base", async () => {
    const page = await opened({
      [PREVIEW]: () => ({ status: 200, body: SAFE }),
      [DELETE]: () => ({ status: 204 }),
    });

    expect(page.textContent).toContain(`Delete ${BRANCH}?`);
    await until(() => expect(page.textContent).toContain("Everything on it is in main."));
    expect(page.textContent).toContain(`origin/${BRANCH}`);
    expect(page.textContent).toContain("/data/worktrees/admin-panel/6f1c2b3a");
    expect(buttonNamed(page, "Delete anyway")).toBeUndefined();

    act(() => buttonNamed(page, "Delete branch")?.click());
    await until(() =>
      expect(sent.find(({ request }) => request === DELETE)?.body).toEqual({
        expected: [
          { kind: "local", commit: "a1" },
          { kind: "remote", commit: "b2" },
        ],
        deleteUnmerged: false,
      }),
    );
    await until(() => expect(page.textContent).toContain(`Branch ${BRANCH} deleted.`));
    expect(closed).toBe(true);
  });

  it("says it is checking the branch while the judgement is on its way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
    );
    await openPage("/", {
      "/": () => (
        <DeleteBranchDialog
          owner={{ kind: "task", taskId: TASK_ID }}
          branch={BRANCH}
          onClose={() => {}}
        />
      ),
    });

    expect(document.body.textContent).toContain("Checking the branch…");
    expect(buttonNamed(document.body, "Delete branch")).toBeUndefined();
  });

  it("says why the branch couldn't be checked", async () => {
    const page = await opened({});

    await until(() => expect(page.textContent).toContain("The branch couldn't be checked"));
    expect(buttonNamed(page, "Delete branch")).toBeUndefined();
  });

  it("warns with the commits lost and the Tasks no Publish took, before Delete anyway", async () => {
    const branch = "initiative/usage-exports";
    const path = `/api/initiatives/${INITIATIVE_ID}/projects/admin-panel/branch-deletion`;
    const page = await opened(
      {
        [`GET ${path}`]: () => ({
          status: 200,
          body: {
            ...SAFE,
            branch,
            copies: [{ kind: "local", name: branch, commit: "c3" }],
            worktreePath: null,
            holdsWork: {
              commitCount: 7,
              subjects: ["Seven", "Six", "Five", "Four", "Three"],
              unpublishedTaskTitles: ["Export usage as CSV"],
            },
          },
        }),
        [`POST ${path}`]: () => ({ status: 204 }),
      },
      { kind: "initiative", initiativeId: INITIATIVE_ID, projectId: "admin-panel" },
      branch,
    );

    await until(() =>
      expect(page.textContent).toContain(
        "It holds 7 commits main doesn't have; they are lost once it's deleted:",
      ),
    );
    expect(page.textContent).toContain("Three");
    expect(page.textContent).toContain("and 2 more");
    expect(page.textContent).toContain("Export usage as CSV");
    expect(page.textContent).not.toContain("Everything on it is in main.");
    expect(buttonNamed(page, "Delete branch")).toBeUndefined();

    act(() => buttonNamed(page, "Delete anyway")?.click());
    await until(() =>
      expect(sent.find(({ request }) => request === `POST ${path}`)?.body).toEqual({
        expected: [{ kind: "local", commit: "c3" }],
        deleteUnmerged: true,
      }),
    );
  });

  it("shows why it is refused, with no button", async () => {
    const page = await opened({
      [PREVIEW]: () => ({
        status: 200,
        body: { ...SAFE, refusal: "Merge or close its pull request first." },
      }),
    });

    await until(() => expect(page.textContent).toContain("Merge or close its pull request first."));
    expect(buttonNamed(page, "Delete branch")).toBeUndefined();
    expect(buttonNamed(page, "Delete anyway")).toBeUndefined();
  });

  it("shows the refusal of a branch that moved since it was checked, and stays open", async () => {
    const page = await opened({
      [PREVIEW]: () => ({ status: 200, body: SAFE }),
      [DELETE]: () => ({
        status: 409,
        body: { reason: "The branch changed since it was checked; check again." },
      }),
    });

    await until(() => expect(buttonNamed(page, "Delete branch")).toBeDefined());
    act(() => buttonNamed(page, "Delete branch")?.click());
    await until(() =>
      expect(page.textContent).toContain("The branch changed since it was checked; check again."),
    );
    expect(page.textContent).toContain("Nothing was deleted");
    expect(closed).toBe(false);
  });
});
