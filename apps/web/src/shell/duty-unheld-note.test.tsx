import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Duty, Role } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { dutyQueries, roleQueries } from "../api/people.ts";
import { aDuty } from "./duties.fixtures.ts";
import { DutyUnheldNote } from "./duty-unheld-note.tsx";
import { dutyHolderOf, dutyUnheldWords } from "./use-duty-holder.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LEAD = { key: "lead", letGoAt: null, card: { name: "Jan" } } as unknown as Role;
const GONE = { key: "planner", letGoAt: "2026-11-01T10:00:00.000Z" } as unknown as Role;

afterEach(() => document.body.replaceChildren());

/** Renders the note in a router of its own, so its link has somewhere to point. */
async function note(duties: readonly Duty[] | undefined): Promise<HTMLElement> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [LEAD]);
  if (duties) queryClient.setQueryData(dutyQueries.list().queryKey, [...duties]);
  const rootRoute = createRootRoute({ component: () => <DutyUnheldNote duty="plans" /> });
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

describe("dutyHolderOf", () => {
  it("finds the holder by the duty, whatever their Role's key", () => {
    expect(dutyHolderOf("plans", [aDuty("plans", "lead")], [LEAD])).toEqual({
      holder: LEAD,
      label: "Plans",
      fallback: undefined,
    });
  });

  it("has no holder while nobody holds it, or while the Role named was let go", () => {
    expect(dutyHolderOf("plans", [aDuty("plans", null)], [LEAD])).toEqual({
      holder: undefined,
      label: "Plans",
      fallback: "user",
    });
    expect(dutyHolderOf("plans", [aDuty("plans", "planner")], [GONE]).holder).toBeUndefined();
  });
});

describe("DutyUnheldNote", () => {
  it("says what applies meanwhile and links to Settings › Duties", async () => {
    const page = await note([aDuty("plans", null)]);

    expect(page.textContent).toBe(
      "Nobody holds Plans, so it is yours meanwhile. Choose who in Settings › Duties.",
    );
    expect(page.querySelector("a")?.getAttribute("href")).toBe("/settings/duties");
    expect(dutyUnheldWords("Implements", "unstaffed")).toBe(
      "Nobody holds Implements, so the Pipelines whose Stages name it can't start.",
    );
  });

  it("says nothing while someone holds it, or until the duties are read", async () => {
    expect((await note([aDuty("plans", "lead")])).textContent).toBe("");
    expect((await note(undefined)).textContent).toBe("");
  });
});
