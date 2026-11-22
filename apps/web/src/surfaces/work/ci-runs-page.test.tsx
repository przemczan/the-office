import type { GitHubState, Project, CiRun, CiRunList, Task } from "@the-office/contracts";
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
import { CiRunsPage } from "./ci-runs-page.tsx";

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
  resolvesTaskId: null,
  projectMoves: [],
  createdBy: { kind: "user", user: null },
  createdAt: "2026-11-10T10:00:00.000Z",
  archivedAt: null,
  endedAt: null,
  pullRequestEnd: null,
  kind: "feature",
  causedBy: null,
  foundInVersion: null,
  foundWhileWorkingOn: null,
  dropReason: null,
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
    deleteMergedBranches: false,
    environment: { set: [], unset: [], prependPath: [] },
    useProjectSkills: false,
    projectSkillsOff: [],
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
    runEnvironment: "not-decided",
    features: {
      "connected-devices": false,
      "test-targets": true,
      "github-issues": true,
      "run-environment": false,
      actions: true,
    },
    projectLimit: 1,
    addedAt: "2026-11-01T10:00:00.000Z",
    codeHost: null,
    kindDefaultPipelines: { feature: null, bug: null, chore: null },
    defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
    issueSettings: {
      autoImportLabel: null,
      closeOnDone: true,
      commentOnStartAndDone: false,
      closeOnDrop: false,
    },
  };
}

const PROJECTS = [aProject("admin-panel", "Admin panel"), aProject("billing", "Billing")];

const FAILED: CiRun = {
  id: 9001,
  projectId: "admin-panel",
  number: 18,
  attempt: 2,
  workflow: "CI",
  title: "Remember the sort",
  trigger: "push",
  branch: `office/${TASK.id}`,
  commit: "abcdef1234567890",
  status: "failed",
  startedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  url: "https://github.com/ada/admin-panel/actions/runs/9001",
  taskId: TASK.id,
};

const SUCCEEDED: CiRun = {
  ...FAILED,
  id: 9002,
  projectId: "billing",
  number: 7,
  attempt: 1,
  title: "Invoices in euros",
  status: "succeeded",
  branch: "main",
  commit: "1234567fedcba",
  taskId: null,
  url: "https://github.com/ada/billing/actions/runs/9002",
};

const SIGNED_IN: GitHubState = {
  status: "signed-in",
  app: { slug: "the-office-ada", owner: "ada", installUrl: "https://github.com/apps/x" },
  login: "ada",
  permissions: null,
};

const LISTED = {
  checkedAt: "2026-11-19T14:00:00.000Z",
  stale: false,
  problem: null,
} as const;

let sent: Sent[] = [];

function openCiRuns(
  list: CiRunList,
  rerun: () => { status: number; body?: unknown } = () => ({
    status: 200,
    body: { projectId: "admin-panel", runId: 9001, jobs: "all" },
  }),
): Promise<{ readonly page: HTMLElement }> {
  sent = stubService({
    "GET /api/ci-runs": () => ({ status: 200, body: list }),
    "POST /api/ci-runs/refresh": () => ({ status: 202 }),
    "POST /api/projects/admin-panel/ci-runs/9001/rerun": rerun,
    "GET /api/tasks": () => ({ status: 200, body: [TASK] }),
    "GET /api/projects": () => ({ status: 200, body: PROJECTS }),
    "GET /api/github": () => ({ status: 200, body: SIGNED_IN }),
  });
  return openPage("/work/ci", { "/work/ci": CiRunsPage });
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
  // While the page is open, so the filter store hears it.
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  closePage();
});

describe("Work › CI", () => {
  it("lists each CI run with its status, link, branch, Task, commit and trigger", async () => {
    const { page } = await openCiRuns({
      runs: [FAILED, SUCCEEDED],
      projects: [
        { projectId: "admin-panel", ...LISTED },
        { projectId: "billing", ...LISTED },
      ],
    });

    await until(() => expect(page.textContent).toContain("Remember the sort"));
    const failed = rowOf(page, "#18");
    const link = linkNamed(failed, "CI #18 · Remember the sort");
    expect(link?.getAttribute("href")).toBe(FAILED.url);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(linkNamed(failed, "Task")?.getAttribute("href")).toBe(`/tasks/${TASK.id}`);
    expect(failed.textContent).toContain("Failed");
    expect(failed.textContent).toContain("attempt 2");
    expect(failed.textContent).toContain("Admin panel");
    expect(failed.textContent).toContain(`office/${TASK.id}`);
    expect(failed.textContent).toContain("abcdef1");
    expect(failed.textContent).not.toContain("abcdef12");
    expect(failed.textContent).toContain("push");
    expect(failed.textContent).toContain("18 min ago");
    expect(failed.textContent).not.toContain("Out of date");

    const succeeded = rowOf(page, "#7");
    expect(succeeded.textContent).toContain("Succeeded");
    expect(succeeded.textContent).not.toContain("attempt");
    expect(linkNamed(succeeded, "Task")).toBeUndefined();
  });

  it("shows only the Projects the filter shows, and says how many more are elsewhere", async () => {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(["billing"]));
    const { page } = await openCiRuns({
      runs: [FAILED, SUCCEEDED],
      projects: [
        {
          projectId: "admin-panel",
          ...LISTED,
          problem: { kind: "cannot-read", text: "GitHub didn't answer." },
        },
      ],
    });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
    });

    await until(() => expect(page.textContent).toContain("Invoices in euros"));
    expect(page.textContent).not.toContain("#18");
    expect(page.textContent).toContain("1 more CI run");
    expect(page.textContent).not.toContain("GitHub didn't answer.");
  });

  it("marks the runs of a Project whose listing is out of date", async () => {
    const { page } = await openCiRuns({
      runs: [FAILED, SUCCEEDED],
      projects: [
        { projectId: "admin-panel", ...LISTED },
        { projectId: "billing", ...LISTED, stale: true },
      ],
    });

    await until(() => expect(page.textContent).toContain("Invoices in euros"));
    expect(rowOf(page, "#7").textContent).toContain("Out of date");
    expect(rowOf(page, "#18").textContent).not.toContain("Out of date");
  });

  it("shows each Project's problem as an Alert naming the Project", async () => {
    const { page } = await openCiRuns({
      runs: [],
      projects: [
        {
          projectId: "billing",
          ...LISTED,
          stale: true,
          problem: {
            kind: "unreachable",
            codeHost: "GitHub",
            failedAt: "2026-11-19T14:02:00.000Z",
          },
        },
        {
          projectId: "admin-panel",
          ...LISTED,
          problem: { kind: "cannot-read", text: "The App can't read Actions." },
        },
      ],
    });

    await until(() => expect(page.textContent).toContain("Billing's CI runs weren't refreshed"));
    expect(page.textContent).toMatch(/GitHub couldn't be reached at \d\d:02\./);
    expect(page.textContent).toContain("Admin panel's CI runs weren't refreshed");
    expect(page.textContent).toContain("The App can't read Actions.");
  });

  it("says what shows here while there are none, and Refresh asks for a read", async () => {
    const { page } = await openCiRuns({ runs: [], projects: [] });

    await until(() => expect(page.textContent).toContain("No CI runs yet."));
    act(() => buttonNamed(page, "Refresh")?.click());

    await until(() =>
      expect(sent.map(({ request }) => request)).toContain("POST /api/ci-runs/refresh"),
    );
  });

  it("offers a re-run only on failed or cancelled runs, and asks for the jobs chosen", async () => {
    const { page } = await openCiRuns({
      runs: [FAILED, SUCCEEDED],
      projects: [],
    });
    await until(() => expect(page.textContent).toContain("Invoices in euros"));

    expect(rowOf(page, "#7").querySelector("button")).toBeNull();
    const menu = rowOf(page, "#18").querySelector("button");
    act(() => menu?.click());
    await until(() => expect(document.body.textContent).toContain("Re-run failed jobs"));
    expect(document.body.textContent).toContain("Re-run all jobs");
    act(() => buttonNamed(document.body, "Re-run failed jobs")?.click());

    await until(() => {
      const call = sent.find(
        ({ request }) => request === "POST /api/projects/admin-panel/ci-runs/9001/rerun",
      );
      expect(call?.body).toEqual({ jobs: "failed" });
    });
  });

  it("shows a refused re-run in its row", async () => {
    const { page } = await openCiRuns({ runs: [FAILED], projects: [] }, () => ({
      status: 422,
      body: { message: "GitHub didn't let The Office re-run it." },
    }));
    await until(() => expect(page.textContent).toContain("#18"));

    act(() => rowOf(page, "#18").querySelector("button")?.click());
    await until(() => expect(document.body.textContent).toContain("Re-run all jobs"));
    act(() => buttonNamed(document.body, "Re-run all jobs")?.click());

    await until(() =>
      expect(rowOf(page, "#18").textContent).toContain("GitHub didn't let The Office re-run it."),
    );
  });
});
