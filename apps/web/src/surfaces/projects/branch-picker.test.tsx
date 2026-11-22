import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Initiative, Project, ProjectBranches, TaskSummary } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { BranchPicker, type BranchChoice } from "./branch-picker.tsx";
import {
  branchChoicesOf,
  initiativeChoicesOf,
  taskChoicesOf,
  TASK_BRANCH_NOTE,
} from "./branch-picker-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the picker's list never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const PROJECT = { id: "website", name: "Website", baseBranch: "main" } as unknown as Project;

const FIX_TASK = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const ADD_TASK = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const DONE_TASK = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const OTHER_PROJECT_TASK = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const UNSTARTED_TASK = "4d5e6f7a-8b9c-4d0e-8f2a-3b4c5d6e7f8a";

const BRANCHES: ProjectBranches = {
  baseBranch: { name: "main", kind: "local", commit: "aaaa" },
  branches: [
    { name: "fix-login", kind: "local", commit: "bbbb" },
    { name: `office/${FIX_TASK}`, kind: "local", commit: "cccc" },
    { name: `office/${DONE_TASK}`, kind: "local", commit: "cccc" },
    { name: `office/${OTHER_PROJECT_TASK}`, kind: "local", commit: "cccc" },
    { name: "origin/main", kind: "remote", commit: "aaaa" },
    { name: `origin/office/${ADD_TASK}`, kind: "remote", commit: "dddd" },
    { name: "origin/initiative/checkout", kind: "remote", commit: "eeee" },
  ],
  fetchProblem: null,
};

function anInitiative(
  id: string,
  name: string,
  state: Initiative["state"],
  branches: Initiative["branches"],
): Initiative {
  return { id, name, state, branches } as unknown as Initiative;
}

const CHECKOUT = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const BILLING = "8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";

const INITIATIVES: Initiative[] = [
  anInitiative(CHECKOUT, "Checkout", "active", [
    { projectId: "website", branch: "initiative/checkout", madeAt: "2026-11-01T00:00:00.000Z" },
  ]),
  anInitiative(BILLING, "Billing", "active", [
    { projectId: "website", branch: "initiative/billing", madeAt: "2026-11-01T00:00:00.000Z" },
  ]),
  anInitiative("9e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b", "Elsewhere", "active", [
    { projectId: "shop", branch: "initiative/elsewhere", madeAt: "2026-11-01T00:00:00.000Z" },
  ]),
  anInitiative("0f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c", "Ended", "done", [
    { projectId: "website", branch: "initiative/ended", madeAt: "2026-11-01T00:00:00.000Z" },
  ]),
];

function aTask(id: string, title: string, state: string, projectId = "website"): TaskSummary {
  return { id, title, state, projectId } as unknown as TaskSummary;
}

const TASKS: TaskSummary[] = [
  aTask(FIX_TASK, "Fix the login form", "in-progress"),
  aTask(ADD_TASK, "Add search", "waiting-on-you"),
  aTask(DONE_TASK, "Done already", "done"),
  aTask(OTHER_PROJECT_TASK, "In the shop", "in-progress", "shop"),
  aTask(UNSTARTED_TASK, "Not started", "backlog"),
];

/** The picker, its lists already read unless `seeded` is false, the service answering 404. */
function rendered({
  value,
  seeded = true,
  branches = BRANCHES,
  answer = () => Promise.resolve(new Response(null, { status: 404 })),
}: {
  readonly value?: BranchChoice;
  readonly seeded?: boolean;
  readonly branches?: ProjectBranches;
  readonly answer?: () => Promise<Response>;
} = {}): { onChange: ReturnType<typeof vi.fn<(choice: BranchChoice) => void>> } {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(answer));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  if (seeded) {
    queryClient.setQueryData(
      projectQueries.branches(PROJECT.id, { fetch: true }).queryKey,
      branches,
    );
    queryClient.setQueryData(initiativeQueries.list().queryKey, INITIATIVES);
    queryClient.setQueryData(taskQueries.list().queryKey, TASKS);
  }
  const onChange = vi.fn<(choice: BranchChoice) => void>();
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <BranchPicker project={PROJECT} value={value} onChange={onChange} />
      </QueryClientProvider>,
    ),
  );
  return { onChange };
}

function box(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!found) throw new Error("No Branch picker.");
  return found;
}

function opened(): void {
  act(() => box().click());
}

function type(text: string): void {
  const input = box();
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Each group's name with its options' names, as listed. */
function listed(): [string, (string | undefined)[]][] {
  return [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="group"]')].map(
    (group) => [
      group.querySelector(".grouped-select-group")?.textContent ?? "",
      [...group.querySelectorAll('[role="option"]')].map(
        ({ id }) => document.getElementById(`${id}-label`)?.textContent,
      ),
    ],
  );
}

function optionNamed(name: string): HTMLElement {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    ({ id }) => document.getElementById(`${id}-label`)?.textContent === name,
  );
  if (!option) throw new Error(`No option ${name}.`);
  return option;
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve));
  });
}

describe("the Branch picker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("lists the branches, base branch first, then the active Initiatives and the Tasks with a branch", () => {
    rendered();
    opened();

    expect(listed()).toEqual([
      [
        "Branches",
        [
          "main",
          "fix-login",
          "initiative/checkout",
          `office/${ADD_TASK}`,
          `office/${DONE_TASK}`,
          `office/${OTHER_PROJECT_TASK}`,
          `office/${FIX_TASK}`,
        ],
      ],
      ["Initiatives", ["Billing", "Checkout"]],
      ["Tasks", ["Add search", "Fix the login form"]],
    ]);
    expect(optionNamed("main").textContent).toContain("base branch");
    expect(optionNamed("Checkout").querySelector("code")?.textContent).toBe("initiative/checkout");
    expect(optionNamed("Add search").querySelector("code")?.textContent).toBe(`office/${ADD_TASK}`);
  });

  it("finds a choice by its name, its title or the branch it means", () => {
    rendered();
    type("checkout");
    expect(listed()).toEqual([
      ["Branches", ["initiative/checkout"]],
      ["Initiatives", ["Checkout"]],
    ]);

    type("login");
    expect(listed()).toEqual([
      ["Branches", ["fix-login"]],
      ["Tasks", ["Fix the login form"]],
    ]);

    type(`office/${ADD_TASK.slice(0, 8)}`);
    expect(listed()).toEqual([
      ["Branches", [`office/${ADD_TASK}`]],
      ["Tasks", ["Add search"]],
    ]);
  });

  it("says a Task's branch is as last committed, on hover", () => {
    rendered();
    opened();

    expect(optionNamed("Fix the login form").title).toBe(TASK_BRANCH_NOTE);
    expect(optionNamed("Checkout").title).toBe("");
    expect(optionNamed("fix-login").title).toBe("");
  });

  it("says so when nothing matches", () => {
    rendered();
    type("nothing-like-it");

    expect(document.querySelector('[role="listbox"]')?.textContent).toBe(
      "No branch, Initiative or Task matches.",
    );
  });

  it("holds the base branch until another is picked, each choice meaning its branch", () => {
    const { onChange } = rendered();
    expect(box().value).toBe("main");

    opened();
    act(() => optionNamed("Checkout").click());
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "initiative",
      initiativeId: CHECKOUT,
      branch: "initiative/checkout",
    });

    opened();
    act(() => optionNamed("Fix the login form").click());
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "task",
      taskId: FIX_TASK,
      branch: `office/${FIX_TASK}`,
    });

    opened();
    act(() => optionNamed("fix-login").click());
    expect(onChange).toHaveBeenLastCalledWith({ kind: "branch", branch: "fix-login" });
  });

  it("shows the Task chosen by its title", () => {
    rendered({ value: { kind: "task", taskId: FIX_TASK, branch: `office/${FIX_TASK}` } });

    expect(box().value).toBe("Fix the login form");
  });

  it("reads the branches only once opened, saying it is fetching them meanwhile", async () => {
    // The read never answers, so it is still fetching.
    rendered({ seeded: false, answer: () => new Promise<Response>(() => {}) });
    expect(document.body.textContent).not.toContain("Fetching branches…");
    await settled();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([]);

    opened();
    await settled();

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain(
      "/api/projects/website/branches?fetch=1",
    );
    expect(document.body.textContent).toContain("Fetching branches…");
    expect(box().value).toBe("main");
  });

  it("warns that some branches may be missing when the remote couldn't be fetched", () => {
    rendered({ branches: { ...BRANCHES, fetchProblem: "The remote didn't answer." } });

    expect(document.body.textContent).toContain(
      "The branches couldn't be fetched, so some may be missing: The remote didn't answer.",
    );
  });
});

describe("the Branch picker's choices", () => {
  it("puts the base branch first, the rest by name, each once", () => {
    expect(branchChoicesOf("main", BRANCHES, ["zeta", "fix-login"]).others).toEqual([
      "fix-login",
      "initiative/checkout",
      `office/${ADD_TASK}`,
      `office/${DONE_TASK}`,
      `office/${OTHER_PROJECT_TASK}`,
      `office/${FIX_TASK}`,
      "zeta",
    ]);
    expect(branchChoicesOf("main", undefined, ["main"])).toEqual({
      baseBranch: "main",
      others: [],
    });
  });

  it("offers the active Initiatives with a branch in the Project, by name", () => {
    expect(initiativeChoicesOf(INITIATIVES, "website").map(({ name }) => name)).toEqual([
      "Billing",
      "Checkout",
    ]);
  });

  it("offers the Project's Tasks not Done or Dropped whose branch is known, by title", () => {
    expect(taskChoicesOf(TASKS, BRANCHES, "website")).toEqual([
      { taskId: ADD_TASK, title: "Add search", branch: `office/${ADD_TASK}` },
      { taskId: FIX_TASK, title: "Fix the login form", branch: `office/${FIX_TASK}` },
    ]);
    expect(taskChoicesOf(TASKS, undefined, "website")).toEqual([]);
  });
});
