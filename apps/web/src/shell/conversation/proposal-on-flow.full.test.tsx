import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { Proposal } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { OVER_QUERY } from "../chat/chat-drawer-width.ts";
import { ChatProvider, useChat } from "../chat/use-chat.tsx";
import { ToastProvider } from "../toasts.tsx";
import {
  OfficeProposalOnFlow,
  ProjectProposalOnFlow,
  useProposalShown,
} from "./proposal-on-flow.tsx";
import { proposalSearchOf } from "./proposal-search.ts";
import {
  PROJECT_ROUTES_PROPOSAL,
  PROJECT_ROUTES_PROPOSAL_ID,
  ROUTES_PROPOSAL,
  ROUTES_PROPOSAL_ID,
} from "./proposed-routes.fixtures.ts";
import { ThreadDraftsProvider } from "./thread-drafts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ServiceCall = (url: string, init?: RequestInit) => Promise<Response>;

const AT = "2026-11-18T11:00:00.000Z";
const DEVOPS_ROLE = { key: "devops", card: { name: "Dwight" } };

const mounted: { readonly root: Root; readonly page: HTMLElement }[] = [];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  for (const { root, page } of mounted.splice(0)) {
    act(() => root.unmount());
    page.remove();
  }
  vi.unstubAllGlobals();
});

/**
 * Reads the Proposal as `proposal`, and answers applying or declining it with its new status.
 */
function serving(proposal: Proposal): Mock<ServiceCall> {
  const fetched = vi.fn<ServiceCall>((url) => {
    if (url.endsWith("/apply"))
      return Promise.resolve(Response.json({ ...proposal, status: answered("applied") }));
    if (url.endsWith("/decline"))
      return Promise.resolve(Response.json({ ...proposal, status: answered("declined") }));
    if (url.endsWith(`/proposals/${proposal.id}`)) return Promise.resolve(Response.json(proposal));
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

function answered(kind: "applied" | "declined"): Proposal["status"] {
  return { kind, at: AT, by: null };
}

/** Settings › Pipelines' choice, in small: the Proposal on Full's flow, or the editor as usual. */
function FullDetail(): ReactNode {
  const onFlow = useProposalShown("full");
  const chat = useChat();
  if (onFlow.reading) return null;
  return (
    <>
      <p data-chat={chat.isOpen ? "open" : "closed"} />
      {onFlow.shown?.change.kind === "pipeline" ? (
        <OfficeProposalOnFlow
          proposal={onFlow.shown.proposal}
          change={onFlow.shown.change}
          pipelineName="Full"
          roles={[DEVOPS_ROLE] as never}
          duties={[]}
        />
      ) : (
        <p>The editor as usual</p>
      )}
    </>
  );
}

/** The Project page's Pipelines section, in small: the Proposal on Full for the-office's flow. */
function ProjectPipelineDetail(): ReactNode {
  const onFlow = useProposalShown("pp-full");
  if (onFlow.reading) return null;
  return onFlow.shown?.change.kind === "project-pipeline" ? (
    <ProjectProposalOnFlow
      proposal={onFlow.shown.proposal}
      change={onFlow.shown.change}
      roles={[DEVOPS_ROLE] as never}
      duties={[]}
    />
  ) : (
    <p>The editor as usual</p>
  );
}

async function opened(address: string): Promise<{
  readonly page: HTMLElement;
  /** Where the page is now, its path and search. */
  readonly address: () => string;
}> {
  const rootRoute = createRootRoute({
    component: () => (
      <ThreadDraftsProvider>
        <ChatProvider>
          <ToastProvider>
            <Outlet />
          </ToastProvider>
        </ChatProvider>
      </ThreadDraftsProvider>
    ),
  });
  const pipelineRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "settings/pipelines/$pipelineId",
    validateSearch: proposalSearchOf,
    component: FullDetail,
  });
  const projectPipelineRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "projects/$projectId/pipelines/$projectPipelineId",
    validateSearch: proposalSearchOf,
    component: ProjectPipelineDetail,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pipelineRoute, projectPipelineRoute]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  mounted.push({ root, page });
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return { page, address: () => router.state.location.href };
}

function button(page: HTMLElement, name: string): HTMLButtonElement {
  // A button's text carries its loader's keyframes after its label.
  const found = [...page.querySelectorAll("button")].find(({ textContent }) =>
    textContent.startsWith(name),
  );
  if (!found) throw new Error(`No ${name} button.`);
  return found;
}

const SHOWN = `/settings/pipelines/full?proposal=${ROUTES_PROPOSAL_ID}`;

describe("a Proposal shown on the flow", () => {
  it("shows the Pipeline read-only under the banner, the proposed and taken-away routes marked", async () => {
    serving(ROUTES_PROPOSAL);
    const { page } = await opened(SHOWN);

    const banner = await vi.waitFor(() => {
      const found = page.querySelector(".proposal-banner");
      if (!found) throw new Error("No banner yet.");
      return found;
    });
    expect(banner.textContent).toContain("Dwight's Proposal, shown on Full: not applied yet");
    expect(banner.textContent).toContain(
      "Routes out of Tests: to Review & fix when Implement changed files, otherwise to Publish.",
    );
    expect(banner.textContent).toContain("Routes out of Docs: taken away with the Stage.");
    expect(banner.textContent).toContain("Nothing changes until you apply it.");
    expect(banner.textContent).not.toContain("Back to the Thread");
    const legend = page.querySelector('[aria-label="What the lines mean"]');
    expect(legend?.textContent).toBe("As it isProposed by DwightTaken away≤N×At most N times");
    expect(page.querySelectorAll(".flow-canvas-route-line--proposed")).toHaveLength(4);
    expect(page.querySelectorAll(".flow-canvas-route-line--taken-away")).toHaveLength(1);
    expect(page.querySelector(".flow-canvas--read-only")).not.toBeNull();
    expect(page.textContent).not.toContain("Add a Stage");
  });

  it("applies the change from the banner, then opens the editor as usual", async () => {
    const fetched = serving(ROUTES_PROPOSAL);
    const { page, address } = await opened(SHOWN);
    await vi.waitFor(() => button(page, "Apply change"));

    await act(async () => button(page, "Apply change").click());

    await vi.waitFor(() => expect(address()).toBe("/settings/pipelines/full"));
    expect(fetched.mock.calls.some(([url]) => url.endsWith(`${ROUTES_PROPOSAL_ID}/apply`))).toBe(
      true,
    );
    expect(document.body.textContent).toContain(
      "Full changed. Tasks that haven't started follow it.",
    );
  });

  it("declines it from Not now", async () => {
    const fetched = serving(ROUTES_PROPOSAL);
    const { page, address } = await opened(SHOWN);
    await vi.waitFor(() => button(page, "Not now"));

    await act(async () => button(page, "Not now").click());

    await vi.waitFor(() => expect(address()).toBe("/settings/pipelines/full"));
    expect(fetched.mock.calls.some(([url]) => url.endsWith(`${ROUTES_PROPOSAL_ID}/decline`))).toBe(
      true,
    );
  });

  it("offers Back to the Thread where the chat covers the page", async () => {
    const unstubbed = window.matchMedia;
    vi.stubGlobal("matchMedia", (query: string) => ({
      ...unstubbed(query),
      matches: query === OVER_QUERY,
    }));
    serving(ROUTES_PROPOSAL);
    const { page } = await opened(SHOWN);
    await vi.waitFor(() => button(page, "Back to the Thread"));
    expect(page.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("closed");

    await act(async () => button(page, "Back to the Thread").click());

    expect(page.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("open");
  });

  it("ignores the Proposal once it is answered, and opens the editor as usual", async () => {
    serving({ ...ROUTES_PROPOSAL, status: answered("applied") });
    const { page } = await opened(SHOWN);

    await vi.waitFor(() => expect(page.textContent).toContain("The editor as usual"));
    expect(page.querySelector(".proposal-banner")).toBeNull();
  });
});

const PROJECT_SHOWN = `/projects/the-office/pipelines/pp-full?proposal=${PROJECT_ROUTES_PROPOSAL_ID}`;

describe("a Project Pipeline Proposal shown on the flow", () => {
  it("shows what the Project gets as proposed, a changed Stage's routes out named from both flows", async () => {
    serving(PROJECT_ROUTES_PROPOSAL);
    const { page } = await opened(PROJECT_SHOWN);

    const banner = await vi.waitFor(() => {
      const found = page.querySelector(".proposal-banner");
      if (!found) throw new Error("No banner yet.");
      return found;
    });
    expect(banner.textContent).toContain(
      "Dwight's Proposal, shown on Full for the-office: not applied yet",
    );
    expect(page.textContent).toContain("Stages and routes");
    expect(page.querySelectorAll(".flow-canvas-route-line--proposed")).toHaveLength(4);
    expect(page.querySelectorAll(".flow-canvas-route-line--taken-away")).toHaveLength(1);

    const review = page.querySelector<HTMLButtonElement>(
      '[data-flow-stage="review"] .flow-canvas-stage-pick',
    );
    if (!review) throw new Error("No Review & fix on the flow.");
    await act(async () => review.click());

    const panel = page.querySelector(".flow-editor-panel");
    expect(panel?.querySelector(".proposal-route-side--from li")?.textContent).toBe(
      "→ Docs, always",
    );
  });

  it("applies the change from the banner, then opens the editor as usual", async () => {
    const fetched = serving(PROJECT_ROUTES_PROPOSAL);
    const { page, address } = await opened(PROJECT_SHOWN);
    await vi.waitFor(() => button(page, "Apply change"));

    await act(async () => button(page, "Apply change").click());

    await vi.waitFor(() => expect(address()).toBe("/projects/the-office/pipelines/pp-full"));
    expect(
      fetched.mock.calls.some(([url]) => url.endsWith(`${PROJECT_ROUTES_PROPOSAL_ID}/apply`)),
    ).toBe(true);
    expect(document.body.textContent).toContain(
      "Full for the-office saved. Tasks that haven't started follow it.",
    );
  });
});
