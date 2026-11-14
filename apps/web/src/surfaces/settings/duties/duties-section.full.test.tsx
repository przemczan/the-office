import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Duty } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleQueries } from "../../../api/people.ts";
import {
  CARETAKER,
  DEVELOPER_LET_GO,
  DEVOPS,
  dutyOf,
  PLANNER,
} from "../../../shell/duty-words.fixtures.ts";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { DutiesSection } from "./duties-section.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PLANS = dutyOf("plans", "Plans", "planner", PLANNER);
const IMPLEMENTS_LET_GO = dutyOf("implements", "Implements", "developer", null);
const MCP_TOOLS = dutyOf(
  "mcp-tool-consultant",
  "Default Consultant for MCP tool hard switches",
  "devops",
  DEVOPS,
);
const TALK_TO: Duty = {
  ...dutyOf("default-person-to-talk-to", "Default person to talk to", null, null),
  fallback: "caretaker",
};

const mounted: Root[] = [];

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
});

function sectionWith(duties: readonly Duty[]): { page: HTMLElement; queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(dutyQueries.list().queryKey, [...duties]);
  queryClient.setQueryData(roleQueries.list().queryKey, [
    CARETAKER,
    PLANNER,
    DEVOPS,
    DEVELOPER_LET_GO,
  ]);
  const page = document.createElement("div");
  const root = createRoot(page);
  mounted.push(root);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PageHeadingProvider setPageHeading={() => undefined}>
            <DutiesSection />
          </PageHeadingProvider>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return { page, queryClient };
}

function picker(page: HTMLElement, label: string): HTMLSelectElement {
  const found = page.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!found) throw new Error(`The page has no picker for ${label}.`);
  return found;
}

function rowOf(page: HTMLElement, label: string): HTMLElement {
  const row = picker(page, label).closest("li");
  if (!row) throw new Error(`${label} has no row.`);
  return row;
}

async function pick(
  page: HTMLElement,
  queryClient: QueryClient,
  label: string,
  value: string,
): Promise<void> {
  await act(async () => {
    const select = picker(page, label);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve));
  });
}

describe("Settings › Duties", () => {
  it("lists each duty with its description and holder, offering only hired Roles", () => {
    const { page } = sectionWith([PLANS, IMPLEMENTS_LET_GO]);

    const plans = picker(page, "Plans");
    expect(plans.value).toBe("planner");
    expect([...plans.options].map(({ textContent }) => textContent)).toEqual([
      "Nobody",
      "Angela · Planner",
      "Dwight · Devops",
    ]);
    expect(rowOf(page, "Plans").textContent).toContain("Writes each Task's Plan");
  });

  it("shows what happens while nobody holds a duty", () => {
    const { page } = sectionWith([PLANS, TALK_TO]);

    expect(picker(page, "Default person to talk to").value).toBe("");
    expect(rowOf(page, "Default person to talk to").textContent).toContain(
      "The Caretaker is the one to talk to.",
    );
    expect(rowOf(page, "Plans").textContent).not.toContain("You do it yourself.");
  });

  it("shows a duty whose holder was let go as held by nobody, saying so", () => {
    const { page } = sectionWith([IMPLEMENTS_LET_GO]);

    expect(picker(page, "Implements").value).toBe("");
    const row = rowOf(page, "Implements").textContent;
    expect(row).toContain("Jim · Developer held it and was let go");
    expect(row).toContain("Pipelines whose Stages name it are flagged, and Start is refused.");
  });

  it("says a Consultant duty's holder with Consultant off is passed over", () => {
    const { page } = sectionWith([MCP_TOOLS]);

    expect(rowOf(page, MCP_TOOLS.label).textContent).toContain(
      "Dwight's Consultant is off, so they are passed over and you are asked.",
    );
  });

  it("saves a pick at once and says who holds the duty now", async () => {
    const changed = dutyOf("plans", "Plans", "devops", DEVOPS);
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(changed)));
    vi.stubGlobal("fetch", fetched);
    const { page, queryClient } = sectionWith([PLANS]);

    await pick(page, queryClient, "Plans", "devops");

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/settings/duties/plans");
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(JSON.stringify({ roleKey: "devops" }));
    expect(picker(page, "Plans").value).toBe("devops");
    expect(page.textContent).toContain("Plans: Dwight · Devops holds it now.");
  });

  it("sends none for Nobody", async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(dutyOf("plans", "Plans", null, null))),
    );
    vi.stubGlobal("fetch", fetched);
    const { page, queryClient } = sectionWith([PLANS]);

    await pick(page, queryClient, "Plans", "");

    expect(fetched.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ roleKey: null }));
    expect(rowOf(page, "Plans").textContent).toContain("You do it yourself.");
  });

  it("shows the service's reason for a refusal and keeps the holder", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { message: "Plans goes to a hired Role.", reasons: ["Plans goes to a hired Role."] },
          { status: 422 },
        ),
      ),
    );
    const { page, queryClient } = sectionWith([PLANS]);

    await pick(page, queryClient, "Plans", "devops");

    const row = rowOf(page, "Plans").textContent;
    expect(row).toContain("Plans wasn't changed");
    expect(row).toContain("Plans goes to a hired Role.");
    expect(picker(page, "Plans").value).toBe("planner");
  });
});
