import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OffBoardTask, OffBoardTaskStatus, Project } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const TASK_ID = "5d1f3a9e-2b7c-4c11-9a0e-6f2d8e4b7a10";
export const DECISION_ID = "0b6e2c4d-8a1f-4e3b-9c7d-2a5f8e1b3c90";
export const THREAD_ID = "7c2e9a1b-3d4f-4a6b-8e0c-1f2a3b4c5d6e";

/** An Off-board Task of the Project, Onboard unless told otherwise, in `status`. */
export function offBoardTask(
  status: OffBoardTaskStatus,
  overrides: Partial<OffBoardTask> = {},
): OffBoardTask {
  return {
    taskId: TASK_ID,
    projectId: "admin-panel",
    title: "Onboard",
    kind: "onboard",
    status,
    stages: ["Onboard", "Verify", "Publish"],
    currentStage: "Onboard",
    person: { roleKey: "devops", name: "Dwight" },
    threadId: THREAD_ID,
    since: new Date(Date.now() - 12 * 60_000).toISOString(),
    tokens: 184_000,
    ...overrides,
  };
}

export const PROJECT: Project = {
  id: "admin-panel",
  name: "Admin panel",
  path: "/projects/admin-panel",
  baseBranch: "main",
  mark: { label: "AP", colour: "teal" },
  installCommand: "npm ci",
  commands: [],
  installInputs: ["package-lock.json"],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
  beforePublishingCommand: "",
  afterPublishingCommand: "",
  deleteMergedBranches: false,
  environment: { set: [], unset: [], prependPath: [] },
  useProjectSkills: true,
  projectSkillsOff: [],
  projectDefault: null,
  useForEveryRole: false,
  roleOverrides: [],
  runEnvironment: "not-decided",
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

/** Answers each request with `answer(url, request)`, or an empty list. */
export function serving(
  answer: (url: string, request: RequestInit | undefined) => unknown,
): ReturnType<typeof vi.fn<(url: string, request?: RequestInit) => Promise<Response>>> {
  const fetched = vi.fn<(url: string, request?: RequestInit) => Promise<Response>>((url, request) =>
    Promise.resolve(Response.json(answer(url, request) ?? [])),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

/** Renders `part` with fresh queries and toasts, once every read has answered. */
export async function rendered(
  part: ReactNode,
): Promise<{ page: HTMLElement; queryClient: QueryClient }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{part}</ToastProvider>
      </QueryClientProvider>,
    );
  });
  // The reads start once the first render commits, so they are waited for after it.
  await act(async () => {
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve));
  });
  return { page, queryClient };
}

/** Presses the button and waits for what it sent and its answer to land. */
export async function pressed(button: HTMLButtonElement, queryClient: QueryClient): Promise<void> {
  await act(async () => {
    button.click();
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve));
  });
}

export function buttonWith(page: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((each) => each.textContent.includes(words));
}

export function linkWith(page: HTMLElement, words: string): HTMLAnchorElement | undefined {
  return [...page.querySelectorAll("a")].find((each) => each.textContent.includes(words));
}
