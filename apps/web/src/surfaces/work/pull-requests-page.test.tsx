import type {
  GitHubState,
  Project,
  PullRequest,
  PullRequestList,
  Task,
} from "@the-office/contracts";
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
import { PROJECT_FILTER_STORAGE_KEY } from "../../shell/project-filter/project-filter-store.ts";
import { PullRequestsPage } from "./pull-requests-page.tsx";

const TASK: Task = {
  id: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  title: "Remember the sort",
  description: "",
  projectId: "admin-panel",
  priority: "normal",
  tags: [],
  state: "in-progress",
  plan: "",
  pausedBy: null,
  engineStandIns: [],
  resumesAt: null,
  autoMode: false,
  initiativePlanningThreadId: null,
  markedPlanned: false,
  hasPlanningThread: false,
  planConfirmed: false,
  filesToChange: [],
  estimatedTokens: null,
  definitionOfDone: [],
  definitionOfDoneConfirmed: false,
  commitMessage: "Remember the sort",
  commitMessageWritten: false,
  commitMessagePublishedAt: null,
  pipelineId: "full",
  proposedPipeline: null,
  blockedBy: [],
  originIdeaId: null,
  initiativeId: null,
  madeFor: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-10T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
  pullRequestEnd: null,
};

function aProject(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/projects/${id}`,
    baseBranch: "main",
    mark: { label: name.slice(0, 2).toUpperCase(), colour: "teal" },
    installCommand: "",
    commands: [],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    icon: { light: null, dark: null },
    logo: { light: null, dark: null },
    repositoryUrl: null,
    beforePublishingCommand: "",
    afterPublishingCommand: "",
    environment: { set: [], unset: [], prependPath: [] },
    useProjectSkills: false,
    projectSkillsOff: [],
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
    runEnvironment: "not-decided",
    projectLimit: 1,
    addedAt: "2026-11-01T10:00:00.000Z",
  };
}

const PROJECTS = [aProject("admin-panel", "Admin panel"), aProject("billing", "Billing")];

const FAILING: PullRequest = {
  id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  projectId: "admin-panel",
  taskId: TASK.id,
  number: 42,
  url: "https://github.com/ada/admin-panel/pull/42",
  title: "Remember the sort",
  branch: `office/${TASK.id}`,
  baseBranch: "main",
  openedAt: "2026-11-10T10:00:00.000Z",
  checks: "failing",
  mergeable: "conflicts",
  checkedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  stale: false,
};

const OF_A_GONE_TASK: PullRequest = {
  id: "2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  projectId: "billing",
  taskId: "7f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  number: 7,
  url: "https://github.com/ada/billing/pull/7",
  title: "Invoices in euros",
  branch: "office/7f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  baseBranch: "develop",
  openedAt: "2026-11-09T10:00:00.000Z",
  checks: "passing",
  mergeable: "yes",
  checkedAt: "2026-11-09T10:05:00.000Z",
  stale: true,
};

const SIGNED_IN: GitHubState = {
  status: "signed-in",
  app: { slug: "the-office-ada", owner: "ada", installUrl: "https://github.com/apps/x" },
  login: "ada",
  permissions: null,
};

let sent: Sent[] = [];

function openPullRequests(
  list: PullRequestList,
  gitHub: GitHubState = SIGNED_IN,
): Promise<{ readonly page: HTMLElement }> {
  sent = stubService({
    "GET /api/pull-requests": () => ({ status: 200, body: list }),
    "POST /api/pull-requests/refresh": () => ({ status: 202 }),
    "GET /api/tasks": () => ({ status: 200, body: [TASK] }),
    "GET /api/projects": () => ({ status: 200, body: PROJECTS }),
    "GET /api/github": () => ({ status: 200, body: gitHub }),
    [`GET /api/pull-requests/${FAILING.id}/merge-methods`]: () => ({
      status: 200,
      body: {
        allowed: ["squash"],
        recommended: "squash",
        warning: null,
        deletesBranchOnMerge: true,
      },
    }),
    [`POST /api/pull-requests/${FAILING.id}/merge`]: () => ({ status: 204 }),
  });
  return openPage("/work/pull-requests", { "/work/pull-requests": PullRequestsPage });
}

function rowOf(page: HTMLElement, text: string): HTMLTableRowElement {
  const row = [...page.querySelectorAll("tr")].find((candidate) =>
    candidate.textContent.includes(text),
  );
  if (!row) throw new Error(`No row holds ${text}`);
  return row;
}

function linkNamed(scope: ParentNode, text: string): HTMLAnchorElement | undefined {
  return [...scope.querySelectorAll("a")].find((link) => link.textContent.trim() === text);
}

afterEach(() => {
  closePage();
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
});

describe("Work › Pull requests", () => {
  it("lists each open pull request with its link, its Task, branch, checks and merge state", async () => {
    const { page } = await openPullRequests({
      pullRequests: [FAILING, OF_A_GONE_TASK],
      problems: [],
    });

    await until(() => expect(page.textContent).toContain("Remember the sort"));
    const failing = rowOf(page, "#42");
    const onGitHub = linkNamed(failing, "#42 Remember the sort");
    expect(onGitHub?.getAttribute("href")).toBe(FAILING.url);
    expect(onGitHub?.getAttribute("target")).toBe("_blank");
    expect(onGitHub?.getAttribute("rel")).toContain("noopener");
    await until(() =>
      expect(linkNamed(rowOf(page, "#42"), "Remember the sort")?.getAttribute("href")).toBe(
        `/tasks/${TASK.id}`,
      ),
    );
    expect(failing.textContent).toContain(`office/${TASK.id} → main`);
    expect(failing.textContent).toContain("Failing");
    expect(failing.textContent).toContain("Conflicts");
    expect(failing.textContent).toContain("18 min ago");
    expect(failing.textContent).toContain("Admin panel");
    expect(failing.textContent).not.toContain("Out of date");

    const gone = rowOf(page, "#7");
    expect(gone.textContent).toContain("Task not found");
    expect(gone.textContent).toContain("Passing");
    expect(gone.textContent).toContain("Can merge");
    expect(gone.textContent).toContain("→ develop");
    // The last refresh couldn't read it.
    expect(gone.textContent).toContain("Out of date");
  });

  it("shows only the Projects the filter shows, and says how many more are elsewhere", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["billing"]));
    const { page } = await openPullRequests({
      pullRequests: [FAILING, OF_A_GONE_TASK],
      problems: [{ kind: "cannot-read", projectId: "admin-panel", text: "GitHub didn't answer." }],
    });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(page.textContent).toContain("#7 Invoices in euros"));
    expect(page.textContent).not.toContain("#42");
    expect(page.textContent).toContain("1 more pull request");
    // The problem is the other Project's.
    expect(page.textContent).not.toContain("GitHub didn't answer.");
  });

  it("shows each Project's problem as an Alert naming the Project", async () => {
    const { page } = await openPullRequests({
      pullRequests: [OF_A_GONE_TASK],
      problems: [
        {
          kind: "unreachable",
          projectId: "billing",
          codeHost: "GitHub",
          failedAt: "2026-11-19T14:02:00.000Z",
          lastReadAt: "2026-11-19T13:58:00.000Z",
        },
      ],
    });

    await until(() =>
      expect(page.textContent).toContain("Billing's pull requests weren't refreshed"),
    );
    // In the user's own time.
    expect(page.textContent).toMatch(
      /GitHub couldn't be reached at \d\d:02; showing what it said at \d\d:58\./,
    );
  });

  it("says how a pull request gets here while there is none, and Refresh asks for a read", async () => {
    const { page } = await openPullRequests({ pullRequests: [], problems: [] });

    await until(() => expect(page.textContent).toContain("No open pull requests."));
    act(() => buttonNamed(page, "Refresh")?.click());

    await until(() =>
      expect(sent.map(({ request }) => request)).toContain("POST /api/pull-requests/refresh"),
    );
  });

  it("offers Merge… and Close… on each row, and a merge reads the list again", async () => {
    const { page } = await openPullRequests({ pullRequests: [FAILING], problems: [] });

    // Every Project, whatever an earlier test's filter left in the store.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });
    await until(() => expect(buttonNamed(rowOf(page, "#42"), "Close…")).toBeDefined());
    act(() => buttonNamed(rowOf(page, "#42"), "Close…")?.click());
    await until(() =>
      expect(document.body.textContent).toContain(
        "Close #42 without merging? The branch stays, and it can be reopened on GitHub.",
      ),
    );
    act(() => buttonNamed(document.body, "Close")?.click());

    act(() => buttonNamed(rowOf(page, "#42"), "Merge…")?.click());
    await until(() => expect(document.body.textContent).toContain("Squash and merge"));
    // Failing checks and conflicts caution, but don't block.
    expect(document.body.textContent).toContain("Checks are failing and it has conflicts");
    const listReads = sent.filter(({ request }) => request === "GET /api/pull-requests").length;
    act(() => buttonNamed(document.body, "Merge pull request")?.click());

    await until(() => expect(document.body.textContent).toContain("#42 merged."));
    expect(sent.filter(({ request }) => request === "GET /api/pull-requests").length).toBe(
      listReads + 1,
    );
  });

  it("asks for the GitHub App's missing permissions only while it lacks some", async () => {
    const without = await openPullRequests({ pullRequests: [], problems: [] });
    await until(() => expect(without.page.textContent).toContain("No open pull requests."));
    expect(without.page.textContent).not.toContain("needs more permissions");
    closePage();

    const { page } = await openPullRequests(
      { pullRequests: [], problems: [] },
      {
        ...SIGNED_IN,
        permissions: {
          missing: [{ name: "checks", level: "read" }],
          appPermissionsUrl: "https://github.com/settings/apps/the-office-ada/permissions",
          installations: [
            { account: "ada", acceptUrl: "https://github.com/settings/installations/7" },
          ],
        },
      },
    );

    await until(() => expect(page.textContent).toContain("The GitHub App needs more permissions"));
    expect(page.textContent).toContain("Checks (read)");
    expect(linkNamed(page, "ada")?.getAttribute("href")).toBe(
      "https://github.com/settings/installations/7",
    );
  });
});
