import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Idea, Project } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries } from "../../api/work.ts";
import { OriginBlock } from "./origin-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IDEA: Idea = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  title: "Usage exports",
  notes: "",
  projectId: "admin-panel",
  state: "shaped",
  taskId: null,
  initiativeId: "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  capturedBy: { kind: "user" },
  capturedAt: "2026-11-07T10:00:00.000Z",
  droppedAt: null,
};

const ADMIN_PANEL: Project = {
  id: "admin-panel",
  name: "Admin panel",
  path: "/projects/admin-panel",
  baseBranch: "main",
  mark: { label: "AP", colour: "teal" },
  installCommand: "",
  commands: [
    { key: "build", name: "Build", kind: "build", commandLine: "" },
    { key: "lint", name: "Lint", kind: "lint", commandLine: "" },
    { key: "test", name: "Test", kind: "test", commandLine: "" },
  ],
  installInputs: [],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
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

/** The Origin block of an Initiative shaped from the Idea, in a router of its own for its links. */
async function originOf(idea: Idea): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(ideaQueries.one(idea.id).queryKey, idea);
  queryClient.setQueryData(projectQueries.list().queryKey, [ADMIN_PANEL]);
  const rootRoute = createRootRoute({
    component: () => (
      <OriginBlock record={{ kind: "initiative", id: IDEA.initiativeId ?? "" }} ideaId={idea.id} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

function chipOf(page: HTMLElement): string | null | undefined {
  return page.querySelector(".project-chip")?.textContent;
}

describe("the Origin block", () => {
  afterEach(() => document.body.replaceChildren());

  it("names the Project the Idea was captured in", async () => {
    const page = await originOf(IDEA);

    // The chip shows the Project's mark's label, then its name.
    expect(chipOf(page)).toBe("APAdmin panel");
  });

  it("says an Idea with no Project is Office-wide", async () => {
    const page = await originOf({ ...IDEA, projectId: null });

    expect(chipOf(page)).toBe("Office-wide");
  });
});
