import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  EngineSettings,
  Project,
  Role,
  RoleCard,
  RoleCardOptions,
  RoleEngineCascade,
} from "@the-office/contracts";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { engineSettingsQuery } from "../../api/engine.ts";
import { dutyQueries, roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { EngineFields } from "./role-card-form.tsx";
import { RoleCardView } from "./role-card-view.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Claude Code and an API endpoint listed, in Settings › Engines' order; Codex listed by none. */
const OPTIONS = {
  engineTypes: [
    {
      type: "openai-compatible-api",
      listed: true,
      models: [{ model: "org/coder:q4", onEveryAccount: true }],
      efforts: [],
    },
    {
      type: "claude-code",
      listed: true,
      models: [
        { model: "claude-opus-5-5", onEveryAccount: false },
        { model: "claude-sonnet-5-5", onEveryAccount: true },
      ],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    },
    { type: "codex", listed: false, models: [], efforts: ["low", "medium", "high", "xhigh"] },
    { type: "gemini-cli", listed: false, models: [], efforts: [] },
  ],
  engines: [
    {
      engine: "work",
      missingCapabilities: ["usageWindows"],
    },
  ],
  knownRoles: [],
  hardSwitches: [],
} as unknown as RoleCardOptions;

const CARD = {
  name: "Pam",
  title: "Developer",
  engineSettings: {
    "claude-code": { model: "claude-opus-5-5", effort: null },
    codex: { model: null, effort: "high" },
  },
  capabilities: { sharedMemory: false, chat: true, consultant: false, runEnvironment: false },
  permissionProfile: { edit: false, run: "read-only-git", web: false, mcpTools: {} },
  hardSwitches: {},
  taskLimit: 1,
  sessionDefault: "context-policy",
  skills: [],
} as unknown as RoleCard;

const ROLE = {
  key: "developer",
  card: CARD,
  builtIn: false,
  letGoAt: null,
  askingYouUntilHired: [],
  mcpServers: [],
} as unknown as Role;

const CASCADE: RoleEngineCascade = {
  outsideProjects: {
    engineId: "work",
    model: "claude-opus-5-5",
    level: "office",
    engineType: "claude-code",
    engineName: "Work account",
    effort: "medium",
    modelLevel: "person",
    effortLevel: "engine",
  },
  elsewhereInProjects: [
    {
      projectId: "shop",
      engineId: "work",
      model: "claude-sonnet-5-5",
      level: "project",
      engineType: "claude-code",
      engineName: "Work account",
      effort: "low",
      modelLevel: "person",
      effortLevel: "projectForce",
    },
  ],
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function rendered(queryClient: QueryClient, shown: () => ReactNode): Promise<HTMLElement> {
  const router = createRouter({
    routeTree: createRootRoute({ component: shown }),
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
  return page;
}

function aQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(engineSettingsQuery().queryKey, {
    engines: [{ id: "work", name: "Work account", kind: "claude-code" }],
  } as unknown as EngineSettings);
  queryClient.setQueryData(dutyQueries.list().queryKey, []);
  queryClient.setQueryData(projectQueries.list().queryKey, [
    { id: "shop", name: "Shop" },
  ] as unknown as Project[]);
  queryClient.setQueryData(roleQueries.engineCascade(ROLE.key).queryKey, CASCADE);
  return queryClient;
}

/** The form's Engine group over a draft it keeps, which `saved` reads after each change. */
async function engineForm(card: RoleCard): Promise<{ page: HTMLElement; saved: () => RoleCard }> {
  let latest = card;
  function Form(): ReactNode {
    const [draft, setDraft] = useState(card);
    return (
      <EngineFields
        draft={draft}
        options={OPTIONS}
        change={(fields) => {
          latest = { ...draft, ...fields };
          setDraft(latest);
        }}
      />
    );
  }
  const page = await rendered(aQueryClient(), () => <Form />);
  return { page, saved: () => latest };
}

function rowOf(page: HTMLElement, type: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`[role="group"][aria-label="${type}"]`);
  if (!row) throw new Error(`There is no row for ${type}.`);
  return row;
}

function selectIn(row: HTMLElement, label: string): HTMLSelectElement | undefined {
  const found = [...row.querySelectorAll("label")].find(
    ({ textContent }) => textContent.trim() === label,
  );
  const control = found && document.getElementById(found.htmlFor);
  return control instanceof HTMLSelectElement ? control : undefined;
}

async function pick(control: HTMLSelectElement | undefined, value: string): Promise<void> {
  if (!control) throw new Error("There is no such field.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
      control,
      value,
    );
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
  });
}

function optionLabels(control: HTMLSelectElement | undefined): string[] {
  return [...(control?.options ?? [])].map(({ textContent }) => textContent);
}

describe("the Role card form's model and effort for each engine type", () => {
  it("has a row per type listed, in Settings › Engines' order, then each type set with none", async () => {
    const { page } = await engineForm(CARD);

    const rows = [...page.querySelectorAll('[role="group"]')].map((row) =>
      row.getAttribute("aria-label"),
    );
    expect(rows).toEqual(["API endpoint", "Claude Code", "Codex"]);
    expect(rowOf(page, "Codex").textContent).toContain("No Codex engine is listed");
    expect(rowOf(page, "Claude Code").textContent).not.toContain("engine is listed");
    expect(page.textContent).toContain(
      "Used on whichever account of the type a session lands on, and on a Stand-in Engine of that type. A Project can set its own for Pam.",
    );
  });

  it("offers the engine's default first, then the type's models and efforts, marking a model not on every account", async () => {
    const { page } = await engineForm(CARD);

    const claudeCode = rowOf(page, "Claude Code");
    expect(optionLabels(selectIn(claudeCode, "Model"))).toEqual([
      "Engine's default",
      "Opus 5.5 · Not on every account",
      "Sonnet 5.5",
    ]);
    expect(selectIn(claudeCode, "Model")?.value).toBe("claude-opus-5-5");
    expect(optionLabels(selectIn(claudeCode, "Effort"))).toEqual([
      "Engine's default",
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
    ]);
    expect(selectIn(claudeCode, "Effort")?.value).toBe("");
    // An API endpoint takes no effort.
    expect(selectIn(rowOf(page, "API endpoint"), "Effort")).toBeUndefined();
  });

  it("sets a type's model and effort, and drops a type set back to the engine's default", async () => {
    const { page, saved } = await engineForm(CARD);

    await pick(selectIn(rowOf(page, "API endpoint"), "Model"), "org/coder:q4");
    await pick(selectIn(rowOf(page, "Claude Code"), "Effort"), "max");
    expect(saved().engineSettings).toEqual({
      "claude-code": { model: "claude-opus-5-5", effort: "max" },
      codex: { model: null, effort: "high" },
      "openai-compatible-api": { model: "org/coder:q4", effort: null },
    });

    await pick(selectIn(rowOf(page, "Claude Code"), "Model"), "");
    await pick(selectIn(rowOf(page, "Claude Code"), "Effort"), "");
    expect(saved().engineSettings["claude-code"]).toBeUndefined();
    // Its row stays while the type is listed.
    expect(rowOf(page, "Claude Code")).toBeDefined();
  });

  it("clears a type no engine is listed for, and its row goes", async () => {
    const { page, saved } = await engineForm(CARD);

    const clear = [...rowOf(page, "Codex").querySelectorAll("button")].find(({ textContent }) =>
      textContent.startsWith("Clear"),
    );
    await act(async () => clear?.click());

    expect(saved().engineSettings.codex).toBeUndefined();
    expect(page.querySelector('[aria-label="Codex"]')).toBeNull();
  });
});

describe("the Role card's Engine group", () => {
  it("shows Works with, each unset part the engine's default, and an unlisted type marked", async () => {
    const page = await rendered(aQueryClient(), () => (
      <RoleCardView role={ROLE} options={OPTIONS} library={[]} />
    ));

    const rows = [...page.querySelectorAll(".role-card-works-with tbody tr")].map(
      ({ textContent }) => textContent,
    );
    expect(rows).toEqual([
      "API endpointEngine's default",
      "Claude CodeOpus 5.5Engine's default",
      "CodexNo Codex engine is listedEngine's defaultHigh",
    ]);
  });

  it("says what it runs on outside any Project, what that engine can't do, and where a Project sets another", async () => {
    const page = await rendered(aQueryClient(), () => (
      <RoleCardView role={ROLE} options={OPTIONS} library={[]} />
    ));

    expect(page.textContent).toContain("Opus 5.5 · effort medium on Work account");
    expect(page.textContent).toContain(
      "It has no usage windows, so the 5-hour window doesn't count it.",
    );
    expect(page.querySelector(".role-card-elsewhere")?.textContent).toBe(
      "In Shop: Sonnet 5.5 · effort low on Work account, forced by the Project",
    );
  });

  it("says each engine's default when no engine type is listed or set", async () => {
    const none = { ...ROLE, card: { ...CARD, engineSettings: {} } } as Role;
    const unlisted = {
      ...OPTIONS,
      engineTypes: OPTIONS.engineTypes.map((type) => ({ ...type, listed: false })),
    };
    const queryClient = aQueryClient();
    queryClient.setQueryData(roleQueries.engineCascade(ROLE.key).queryKey, {
      outsideProjects: null,
      elsewhereInProjects: [],
    });
    const page = await rendered(queryClient, () => (
      <RoleCardView role={none} options={unlisted} library={[]} />
    ));

    expect(page.textContent).toContain("Each engine's default model and effort");
    expect(page.textContent).toContain("No engine: add one in Settings › Engines");
  });
});
