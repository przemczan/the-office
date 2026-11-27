import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { AuthorityInEffect, Role, RoleCardOptions } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changeRoleCard, roleCardQueries, roleQueries } from "../../api/people.ts";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { AUTHORITY_AREAS, NEVER_EVERYWHERE } from "../../shell/authority.fixtures.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { AuthorityTab } from "./authority-tab.tsx";

vi.mock("../../api/people.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/people.ts")>()),
  changeRoleCard: vi.fn<typeof changeRoleCard>(),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = {
  knownRoles: [
    { key: "devops", title: "Devops" },
    { key: "developer", title: "Developer" },
  ],
  authority: AUTHORITY_AREAS,
  fromScratchAuthority: NEVER_EVERYWHERE,
} as unknown as RoleCardOptions;

function person(key: string, name: string, more: Partial<Role> = {}): Role {
  return {
    key,
    card: { name, title: name, authority: {} },
    presetAuthority: NEVER_EVERYWHERE,
    builtIn: false,
    letGoAt: null,
    askingYouUntilHired: [],
    ...more,
  } as unknown as Role;
}

const CARETAKER = person("caretaker", "Jan", { builtIn: true });
const ADA = person("developer", "Ada", {
  presetAuthority: { ...NEVER_EVERYWHERE, movingWork: { kind: "ask-me" } } as AuthorityInEffect,
});
const BOB = person("devops", "Bob", {
  card: { name: "Bob", title: "Devops", authority: { movingWork: { kind: "allowed" } } },
} as Partial<Role>);
const GONE = person("planner", "Zed", { letGoAt: "2026-11-01T00:00:00.000Z" });

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.mocked(changeRoleCard).mockReset();
});

async function shownTab(): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [CARETAKER, ADA, BOB, GONE]);
  queryClient.setQueryData(roleCardQueries.options().queryKey, OPTIONS);
  const rootRoute = createRootRoute({
    component: () => (
      <PageHeadingProvider setPageHeading={() => undefined}>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </PageHeadingProvider>
    ),
  });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/authority",
    component: AuthorityTab,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/authority"] }),
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

const rowOf = (page: HTMLElement, label: string): HTMLTableRowElement => {
  const found = [...page.querySelectorAll("tbody tr")].find((each) =>
    each.querySelector("th")?.textContent.startsWith(label),
  );
  if (!(found instanceof HTMLTableRowElement)) throw new Error(`No row ${label}.`);
  return found;
};

const cellsOf = (row: HTMLTableRowElement): string[] =>
  [...row.querySelectorAll("td")].map(({ textContent }) => textContent);

const button = (page: HTMLElement, name: string): HTMLButtonElement => {
  const found = [...page.querySelectorAll("button")].find(({ textContent }) =>
    textContent.startsWith(name),
  );
  if (!found) {
    const shown = [...page.querySelectorAll("button")].map(({ textContent }) => textContent);
    throw new Error(`No button ${name} among ${JSON.stringify(shown)}.`);
  }
  return found;
};

const click = (control: HTMLElement): void => act(() => control.click());

function pick(page: HTMLElement, label: string, value: string): void {
  const text = [...page.querySelectorAll("label")].find((each) => each.textContent === label);
  const control = text && document.getElementById(text.htmlFor);
  if (!(control instanceof HTMLSelectElement)) throw new Error(`No select ${label}.`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
      control,
      value,
    );
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the Authority tab", () => {
  it("shows a column per person not let go and each row's values with their counts", async () => {
    const page = await shownTab();

    // Each person's head is their Avatar's initial, then their name.
    expect([...page.querySelectorAll("thead th")].map(({ textContent }) => textContent)).toEqual([
      "Authority",
      "JJanBuilt in",
      "AAda",
      "BBob",
      "People",
    ]);
    expect(cellsOf(rowOf(page, "Moving work"))).toEqual([
      "Never",
      "Preset default (Ask me)",
      "Allowed",
      "Never 1 · Ask me 1 · Allowed 1",
    ]);
    expect(page.querySelector("tbody tr th")?.textContent).toBe("Work");
  });

  it("hides the rows on which everyone has the same value", async () => {
    const page = await shownTab();
    const labels = () =>
      [...page.querySelectorAll("tbody th[scope=row]")].map((th) => th.textContent);
    expect(labels().length).toBeGreaterThan(1);

    click(page.querySelector<HTMLElement>("[role=switch]") as HTMLElement);

    expect(labels()).toEqual(["Moving work"]);
  });

  it("changes several people's cells and saves each person's card once", async () => {
    vi.mocked(changeRoleCard).mockImplementation((_key, card) =>
      Promise.resolve({ ...ADA, card: card as Role["card"] }),
    );
    const page = await shownTab();

    click(button(page, "Edit Authority"));
    expect(page.textContent).not.toContain("You have unsaved changes.");
    // The Caretaker's column stays plain: the two others have a select per value of a row.
    expect(page.querySelectorAll("tbody select").length).toBe(2 * 10);
    pick(page, "Moving work, Ada", "never");
    pick(page, "Moving work, Bob", "ask-me");
    expect(page.textContent).toContain("You have unsaved changes.");
    click(button(page, "Save changes"));
    await flush();

    const saved = vi.mocked(changeRoleCard).mock.calls;
    expect(saved.map(([key]) => key)).toEqual(["developer", "devops"]);
    expect(saved[0]?.[1].authority).toEqual({ movingWork: { kind: "never" } });
    expect(saved[1]?.[1].authority).toEqual({ movingWork: { kind: "ask-me" } });
    expect(page.querySelector("tbody select")).toBeNull();
  });

  it("drops a row picked back to the preset's default from the card", async () => {
    vi.mocked(changeRoleCard).mockResolvedValue(BOB);
    const page = await shownTab();

    click(button(page, "Edit Authority"));
    pick(page, "Moving work, Bob", "never");
    click(button(page, "Save changes"));
    await flush();

    expect(changeRoleCard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changeRoleCard).mock.calls[0]?.[1].authority).toEqual({});
  });

  it("names who wasn't saved with the service's reason, and keeps their edit", async () => {
    vi.mocked(changeRoleCard).mockImplementation((key) =>
      key === "devops"
        ? Promise.reject(new Error("Devops can't be changed."))
        : Promise.resolve(ADA),
    );
    const page = await shownTab();

    click(button(page, "Edit Authority"));
    pick(page, "Moving work, Ada", "never");
    pick(page, "Moving work, Bob", "ask-me");
    click(button(page, "Save changes"));
    await flush();

    expect(page.textContent).toContain("Not saved: Bob");
    expect(page.textContent).toContain("Bob: Devops can't be changed.");
    // Ada is saved and leaves edit mode; Bob keeps his select and his edit.
    expect(rowOf(page, "Moving work").querySelectorAll("select").length).toBe(1);
    expect(page.textContent).toContain("You have unsaved changes.");
  });

  it("cancels the edits", async () => {
    const page = await shownTab();

    click(button(page, "Edit Authority"));
    pick(page, "Moving work, Ada", "never");
    click(button(page, "Cancel"));

    expect(page.querySelector("tbody select")).toBeNull();
    expect(cellsOf(rowOf(page, "Moving work"))[1]).toBe("Preset default (Ask me)");
  });
});
