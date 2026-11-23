import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  EngineSettings,
  Project,
  ProjectEngine,
  Role,
  RoleCardOptions,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { engineSettingsQuery } from "../../api/engine.ts";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { stubService, type Answers, type Sent } from "../../shell/page.fixtures.tsx";
import { ToastProvider } from "../../shell/toasts.tsx";
import { EngineBlock } from "./engine-block.tsx";

/** The Engine card's tests: two Claude Code accounts and a Codex one, and three people. */

export const PROJECT: Project = {
  id: "shop",
  name: "Shop",
  path: "/projects/shop",
  baseBranch: "main",
  mark: { label: "SH", colour: "teal" },
  installCommand: "npm ci",
  commands: [],
  installInputs: [],
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
  engine: {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: [] },
  },
  runEnvironment: "on",
  features: {
    "connected-devices": true,
    "test-targets": true,
    "github-issues": true,
    "run-environment": true,
    actions: true,
  },
  projectLimit: 1,
  addedAt: "2026-11-01T10:00:00.000Z",
  codeHost: "GitHub",
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  issueSettings: {
    autoImportLabel: null,
    closeOnDone: true,
    commentOnStartAndDone: false,
    closeOnDrop: false,
  },
};

export function projectWith(engine: Partial<ProjectEngine>): Project {
  return { ...PROJECT, engine: { ...PROJECT.engine, ...engine } };
}

/** Codex is listed first in Settings › Engines, so the spec's order of types puts Claude Code first. */
const SETTINGS = {
  engines: [
    { id: "codex-1", name: "Codex account", kind: "codex" },
    { id: "work", name: "Work account", kind: "claude-code" },
    { id: "personal", name: "Personal", kind: "claude-code" },
  ],
  officeDefault: { engineType: "claude-code", engineId: "work" },
  standInEngines: ["personal", "codex-1"],
} as unknown as EngineSettings;

const OPTIONS = {
  engineTypes: [
    {
      type: "codex",
      listed: true,
      models: [{ model: "gpt-5.5-codex", onEveryAccount: true }],
      efforts: ["low", "medium", "high", "xhigh"],
    },
    {
      type: "claude-code",
      listed: true,
      models: [
        { model: "claude-opus-5-5", onEveryAccount: true },
        { model: "claude-sonnet-5-5", onEveryAccount: true },
      ],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    },
    { type: "gemini-cli", listed: false, models: [], efforts: [] },
  ],
  engines: [],
  knownRoles: [],
  hardSwitches: [],
} as unknown as RoleCardOptions;

function aRole(key: string, name: string, title: string, more: Partial<Role> = {}): Role {
  return {
    key,
    card: {
      name,
      title,
      engineSettings: { "claude-code": { model: "claude-sonnet-5-5", effort: "high" } },
    },
    letGoAt: null,
    avatar: null,
    ...more,
  } as unknown as Role;
}

export const ROLES: readonly Role[] = [
  aRole("developer", "Dwight", "Developer"),
  aRole("reviewer", "Rita", "Reviewer"),
  aRole("planner", "Pam", "Planner"),
  aRole("former", "Fred", "Tester", { letGoAt: "2026-10-01T10:00:00.000Z" }),
];

let root: Root | undefined;

/** The card as the page shows it: reading the Project, so a saved answer redraws it. */
function Shown(): ReactNode {
  const project = useQuery(projectQueries.one(PROJECT.id)).data;
  return project ? <EngineBlock project={project} /> : null;
}

/**
 * The card over `project`, its readings already in hand, Settings › Engines' too unless
 * `settingsRead` is false; the service answers `answers` and every request sent is recorded.
 */
export async function engineCard(
  project: Project,
  answers: Answers = {},
  { settingsRead = true }: { readonly settingsRead?: boolean } = {},
): Promise<{ readonly page: HTMLElement; readonly sent: Sent[] }> {
  const sent = stubService(answers);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(projectQueries.one(PROJECT.id).queryKey, project);
  if (settingsRead) queryClient.setQueryData(engineSettingsQuery().queryKey, SETTINGS);
  queryClient.setQueryData(roleCardQueries.options().queryKey, OPTIONS);
  queryClient.setQueryData(roleQueries.list().queryKey, [...ROLES]);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ToastProvider>
          <Shown />
        </ToastProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return { page, sent };
}

export function closeCard(): void {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
}

/** The service's answer to a save: the Project as it is after it. */
export function savedAs(project: Project): Answers[string] {
  return () => ({ status: 200, body: project });
}

export const PUT_ENGINE = `PUT /api/projects/${PROJECT.id}/engine`;

export function refused(reason: string): Answers[string] {
  return () => ({ status: 422, body: { message: "Not saved.", reasons: [reason] } });
}

/** The `<select>` labelled `label` inside `scope`. */
export function selectIn(scope: ParentNode, label: string): HTMLSelectElement {
  const found = [...scope.querySelectorAll("label")].find(
    ({ textContent }) => textContent.replace("*", "").trim() === label,
  );
  const control = found && document.getElementById(found.htmlFor);
  if (!(control instanceof HTMLSelectElement)) throw new Error(`There is no field ${label}.`);
  return control;
}

export async function pick(control: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
      control,
      value,
    );
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
  });
}

export function optionLabels(control: HTMLSelectElement): string[] {
  return [...control.options].map(({ textContent }) => textContent);
}

/** The group of the card, or of a window, named `name`. */
export function groupOf(scope: ParentNode, name: string): HTMLElement {
  const byLabel = scope.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`);
  if (byLabel) return byLabel;
  const section = [...scope.querySelectorAll<HTMLElement>("section[aria-labelledby]")].find(
    (candidate) =>
      document.getElementById(candidate.getAttribute("aria-labelledby") ?? "")?.textContent ===
      name,
  );
  if (!section) throw new Error(`There is no group ${name}.`);
  return section;
}

/** The window open now. */
export function shownDialog(): HTMLElement {
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error("No window is open.");
  return dialog;
}

export function click(element: HTMLElement | undefined): void {
  if (!element) throw new Error("There is nothing to click.");
  act(() => element.click());
}
