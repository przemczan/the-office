import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, TaskState } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import { TestTargetsBlock } from "./test-targets-block.tsx";

vi.mock("../../shell/ask-devops.tsx", () => ({ useDevops: () => undefined }));
vi.mock("../../shell/use-user-name.ts", () => ({ useSignedInUserId: () => "u1" }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params: { taskId: string };
  }) => <a href={to.replace("$taskId", params.taskId)}>{children}</a>,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT: Project = {
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const TASK: { id: string; title: string; state: TaskState } = {
  id: "t1",
  title: "Set up test targets for Admin panel",
  state: "ready",
};

/** Answers each request by its method and path. */
function serving(openTask: typeof TASK | null) {
  const fetched = vi.fn<(url: string, request?: RequestInit) => Promise<Response>>(
    (url, request) => {
      if (url.endsWith("/test-targets")) return Promise.resolve(Response.json({ targets: [] }));
      if (url.endsWith("/set-up-task"))
        return Promise.resolve(Response.json({ setUpTask: openTask }));
      if (url.endsWith("/test-targets/set-up") && request?.method === "POST") {
        return Promise.resolve(Response.json({ setUpTask: TASK }));
      }
      return Promise.resolve(Response.json([]));
    },
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

async function shown(): Promise<{ page: HTMLElement; queryClient: QueryClient }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TestTargetsBlock project={PROJECT} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve));
  });
  return { page, queryClient };
}

function setUpButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((each) =>
    each.textContent.includes("Set up test targets"),
  );
}

describe("the Project page's Test targets block, setting up", () => {
  it("adds the set-up Task when Set up test targets is pressed, and says it is Ready", async () => {
    const fetched = serving(null);
    const { page, queryClient } = await shown();

    const button = setUpButton(page);
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
      await new Promise((resolve) => setTimeout(resolve));
    });

    const post = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(post?.[0]).toBe("/api/projects/admin-panel/test-targets/set-up");
    expect(document.body.textContent).toContain(`${TASK.title} is Ready, waiting for your Start.`);
    expect(page.textContent).toContain("Being set up in the Task");
    expect(setUpButton(page)).toBeUndefined();
  });

  it("shows the open set-up Task in place of the button", async () => {
    serving({ ...TASK, state: "in-progress" });
    const { page } = await shown();

    await vi.waitFor(() => expect(page.textContent).toContain("Being set up"));
    expect(setUpButton(page)).toBeUndefined();
    expect(page.textContent).toContain(`Being set up in the Task ${TASK.title} · In progress.`);
    expect(page.querySelector("a")?.getAttribute("href")).toBe("/tasks/t1");
  });
});
