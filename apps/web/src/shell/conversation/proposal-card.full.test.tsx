import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type {
  Preset,
  Proposal,
  ProposalDeclinedBecause,
  ProposalStatus,
  ProposedFeatureSwitch,
  Stage,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { officeInstructionsQuery } from "../../api/conversations.ts";
import { dutyQueries, roleCardQueries, roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { ChatProvider } from "../chat/use-chat.tsx";
import { DEVOPS, dutyOf, PLANNER } from "../duty-words.fixtures.ts";
import { ToastProvider } from "../toasts.tsx";
import { BY_ANN, BY_YOU, signIn } from "../user.fixtures.ts";
import { ProposalCard } from "./proposal-card.tsx";
import {
  FULL_NOW,
  FULL_PROPOSED,
  PROJECT_ROUTES_PROPOSAL,
  ROUTES_PROPOSAL,
  ROUTES_PROPOSAL_ID,
} from "./proposed-routes.fixtures.ts";
import { ThreadDraftsProvider } from "./thread-drafts.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout, so the chat drawer's room never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

type ServiceCall = (url: string, init?: RequestInit) => Promise<Response>;

const PROPOSAL_ID = "6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0a01";
const AT = "2026-11-06T10:00:00.000Z";
const SEVERAL_LINES = "Write in plain words.\n\n- Say what changed\n- Say what is next";

const mounted: { readonly root: Root; readonly page: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, page } of mounted.splice(0)) {
    act(() => root.unmount());
    page.remove();
  }
  vi.unstubAllGlobals();
});

function officeInstructionsProposal(
  to: string,
  status: ProposalStatus = { kind: "open" },
): Proposal {
  return {
    id: PROPOSAL_ID,
    threadId: "6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0a02",
    draftedBy: "office-manager",
    draftedAt: AT,
    change: { kind: "office-instructions", from: "Be kind.", to },
    status,
  };
}

/** Answers `POST .../apply` with `answer`; what the card reads besides stays empty. */
function serviceAnswering(answer: Proposal): Mock<ServiceCall> {
  const fetched = vi.fn<ServiceCall>((_url, init) =>
    Promise.resolve(Response.json(init?.method === "POST" ? answer : [])),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

/** The card on its own, inside a router as every page shows it. */
async function cardOf(proposal: Proposal, queryClient = new QueryClient()): Promise<HTMLElement> {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ThreadDraftsProvider>
          <ChatProvider>
            <ToastProvider>
              <ProposalCard proposal={proposal} />
            </ToastProvider>
          </ChatProvider>
        </ThreadDraftsProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/now"] }),
  });
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  mounted.push({ root, page });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return page;
}

function button(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find(({ textContent }) =>
    textContent.includes(name),
  );
  if (!found) throw new Error(`The card has no ${name} button.`);
  return found;
}

function promptTemplateProposal(to: string | null): Proposal {
  return {
    id: PROPOSAL_ID,
    threadId: "6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0a02",
    draftedBy: "office-manager",
    draftedAt: AT,
    change: {
      kind: "prompt-template",
      key: "resolve-brief",
      name: "Resolve's Brief",
      from: "Old.",
      to,
    },
    status: { kind: "open" },
  };
}

describe("ProposalCard on a prompt template", () => {
  it("names the template and shows the new text whole", async () => {
    serviceAnswering(promptTemplateProposal(SEVERAL_LINES));
    const card = await cardOf(promptTemplateProposal(SEVERAL_LINES));
    expect(card.textContent).toContain("Change the prompt template · Resolve's Brief");
    expect(card.querySelector(".proposal-text")?.textContent).toBe(SEVERAL_LINES);
    expect(card.textContent).toContain("Applies to prompts rendered after it.");
  });

  it("says a reset goes back to the default", async () => {
    serviceAnswering(promptTemplateProposal(null));
    const card = await cardOf(promptTemplateProposal(null));
    expect(card.textContent).toContain("Reset Resolve's Brief to its default");
    expect(card.textContent).toContain("Back to the default that ships with The Office");
    expect(card.querySelector(".proposal-text")).toBeNull();
  });

  it("applies through the Proposal's apply endpoint", async () => {
    const fetched = serviceAnswering({
      ...promptTemplateProposal(SEVERAL_LINES),
      status: { kind: "applied", at: AT, by: null },
    });
    const card = await cardOf(promptTemplateProposal(SEVERAL_LINES));
    await act(async () => {
      button(card, "Apply change").click();
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain("Prompt template changed."),
      );
    });
    expect(fetched).toHaveBeenCalledWith(
      `/api/proposals/${PROPOSAL_ID}/apply`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("ProposalCard on the Office instructions", () => {
  it("says what it changes and shows the whole text with its line breaks", async () => {
    serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
    const card = await cardOf(officeInstructionsProposal(SEVERAL_LINES));
    expect(card.textContent).toContain("Change the Office instructions");
    expect(card.textContent).toContain("New Office instructions");
    expect(card.querySelector(".proposal-text")?.textContent).toBe(SEVERAL_LINES);
  });

  it("says they would be emptied when the new text is empty", async () => {
    serviceAnswering(officeInstructionsProposal(""));
    const card = await cardOf(officeInstructionsProposal(""));
    expect(card.textContent).toContain("the Office instructions would be emptied");
    expect(card.querySelector(".proposal-text")).toBeNull();
  });

  it("applies as the other Office settings do, refreshing the Office instructions", async () => {
    const fetched = serviceAnswering(
      officeInstructionsProposal(SEVERAL_LINES, { kind: "applied", at: AT, by: null }),
    );
    const queryClient = new QueryClient();
    const refreshed = vi.spyOn(queryClient, "invalidateQueries");
    const card = await cardOf(officeInstructionsProposal(SEVERAL_LINES), queryClient);
    await act(async () => {
      button(card, "Apply change").click();
      await vi.waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2));
    });
    expect(fetched).toHaveBeenCalledWith(
      `/api/proposals/${PROPOSAL_ID}/apply`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(refreshed).toHaveBeenCalledWith({ queryKey: officeInstructionsQuery().queryKey });
    expect(document.body.textContent).toContain("Change applied.");
  });

  it.each([
    [{ kind: "applied", at: AT, by: null }, "Applied"],
    [{ kind: "declined", at: AT, by: null, because: null }, "Not applied"],
  ] satisfies [ProposalStatus, string][])("shows what became of it: %j", async (status, words) => {
    serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
    const card = await cardOf(officeInstructionsProposal(SEVERAL_LINES, status));
    expect(card.textContent).toContain(words);
    expect(card.querySelector(".proposal-text")?.textContent).toBe(SEVERAL_LINES);
    expect(card.querySelectorAll("button")).toHaveLength(0);
  });

  it.each([
    [{ kind: "applied", at: AT, by: BY_YOU }, "Applied", "by you"],
    [{ kind: "applied", at: AT, by: BY_ANN }, "Applied", "by Ann Lee"],
    [{ kind: "declined", at: AT, by: BY_YOU, because: null }, "Not applied", "by you"],
    [{ kind: "declined", at: AT, by: BY_ANN, because: null }, "Not applied", "by Ann Lee"],
  ] satisfies [ProposalStatus, string, string][])(
    "names the user who applied or declined it: %j",
    async (status, badge, by) => {
      serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
      const queryClient = new QueryClient();
      signIn(queryClient);
      const card = await cardOf(officeInstructionsProposal(SEVERAL_LINES, status), queryClient);
      expect(card.querySelector(".proposal-foot")?.textContent).toContain(badge);
      expect(card.querySelector(".proposal-foot .proposal-note")?.textContent).toMatch(
        new RegExp(`^${by} · `),
      );
    },
  );

  it.each([
    [{ kind: "consultation-closed" }, "Declined as its Consultation closed"],
    [{ kind: "thread-deleted" }, "Declined as its Thread was deleted"],
    [
      { kind: "superseded", proposalId: PROPOSAL_ID },
      "Declined as a newer Proposal changing the same was applied",
    ],
  ] satisfies [ProposalDeclinedBecause, string][])(
    "says why The Office declined it on its own: %j",
    async (because, words) => {
      serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
      const status: ProposalStatus = { kind: "declined", at: AT, by: null, because };
      const card = await cardOf(officeInstructionsProposal(SEVERAL_LINES, status));
      expect(card.querySelector(".proposal-foot")?.textContent).toContain("Not applied");
      expect(card.querySelector(".proposal-foot .proposal-note")?.textContent).toMatch(
        new RegExp(`^${words} · `),
      );
    },
  );
});

function proposalOf(
  change: Proposal["change"],
  status: ProposalStatus = { kind: "open" },
): Proposal {
  return { ...officeInstructionsProposal(""), draftedBy: "devops", change, status };
}

const TESTS: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  command: "test",
  optional: false,
};
const LINUX: Stage = {
  kind: "script",
  key: "linux",
  name: "Verify on Linux",
  command: "linux",
  optional: false,
};

/** Answers each read by its path, and `POST .../apply` with `applied`. */
function serviceReading(answers: Record<string, unknown>, applied?: Proposal): Mock<ServiceCall> {
  const fetched = vi.fn<ServiceCall>((url) => {
    const path = url.replace(/^\/api/, "").split("?")[0] ?? "";
    if (path.endsWith("/apply")) return Promise.resolve(Response.json(applied));
    return Promise.resolve(Response.json(answers[path] ?? []));
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

const PP_LINUX = {
  id: "pp-linux",
  projectId: "the-office",
  name: "Full with Linux check",
  description: "",
  stages: [TESTS, LINUX],
  copiedFrom: { name: "Full", at: AT },
  brokenBeforeUpdate: null,
};

describe("ProposalCard on a Project Pipeline", () => {
  const newOne = proposalOf({
    kind: "project-pipeline",
    routes: null,
    projectId: "the-office",
    pipelineId: null,
    from: null,
    to: {
      name: "Full with Linux check",
      description: "Then Linux.",
      stages: [TESTS, LINUX],
      copyOf: "full",
    },
  });

  it("says it adds the Project Pipeline to its Project, copied from an office-wide Pipeline, with its Stages", async () => {
    serviceReading({
      "/projects": [],
      "/pipelines": [{ id: "full", name: "Full", description: "", stages: [TESTS] }],
    });
    const card = await cardOf(newOne);

    await vi.waitFor(() => expect(card.textContent).toContain("Copied fromFull"));
    expect(card.textContent).toContain("Add Full with Linux check to the-office's Pipelines");
    expect(card.textContent).toContain("StagesTests → Verify on Linux");
    expect(card.textContent).toContain("Refused if it changes before you apply this");
  });

  it("names another of the Project's own Pipelines it is copied from", async () => {
    serviceReading({ "/projects": [], "/pipelines": [], "/project-pipelines": [PP_LINUX] });
    const card = await cardOf(
      proposalOf({
        kind: "project-pipeline",
        routes: null,
        projectId: "the-office",
        pipelineId: null,
        from: null,
        to: { name: "Linux twice", description: "", stages: [TESTS, LINUX], copyOf: "pp-linux" },
      }),
    );

    await vi.waitFor(() => expect(card.textContent).toContain("Copied fromFull with Linux check"));
  });

  it("refreshes the Pipeline lists once applied, and says so", async () => {
    serviceReading({}, { ...newOne, status: { kind: "applied", at: AT, by: null } });
    const queryClient = new QueryClient();
    const refreshed = vi.spyOn(queryClient, "invalidateQueries");
    const card = await cardOf(newOne, queryClient);

    await act(async () => {
      button(card, "Apply change").click();
      await vi.waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2));
    });

    expect(refreshed).toHaveBeenCalledWith({ queryKey: pipelineQueries.list().queryKey });
    expect(document.body.textContent).toContain(
      "Full with Linux check added to the-office's Pipelines.",
    );
  });

  it("titles a change by the Project Pipeline it changes, with the Stages it adds", async () => {
    serviceReading({});
    const card = await cardOf(
      proposalOf({
        kind: "project-pipeline",
        routes: null,
        projectId: "the-office",
        pipelineId: "pp-linux",
        from: { name: "Full with Linux check", description: "Then Linux.", stages: [TESTS] },
        to: {
          name: "Full with Linux check",
          description: "Linux, then publish.",
          stages: [TESTS, LINUX],
        },
      }),
    );

    expect(card.textContent).toContain("Change the-office's Full with Linux check");
    expect(card.textContent).toContain("DescriptionThen Linux.Linux, then publish.");
    expect(card.textContent).toContain("AddedVerify on Linux");
  });

  it("shows a change's routes as Was and Proposed, then the flow as proposed, as an office-wide one does", async () => {
    serviceReading({ "/projects": [], "/pipelines": [] });
    const { card } = await routedCardOf(PROJECT_ROUTES_PROPOSAL);

    await vi.waitFor(() =>
      expect(card.textContent).toContain("Change the-office's Full for the-office"),
    );
    const labels = [...card.querySelectorAll(".proposal-change-label")].map(
      ({ textContent }) => textContent,
    );
    expect(labels).toEqual([
      "Stages",
      "Routes out of Tests",
      "Routes out of Review & fix",
      "Routes out of Verify on Linux",
      "Routes out of Docs",
    ]);
    const flow = card.querySelector('[aria-label="Full for the-office, as proposed"]');
    expect(flow?.querySelectorAll(".flow-canvas-route-line--proposed")).toHaveLength(4);
    expect(flow?.querySelector("button")?.textContent).toMatch(/^Show it on the flow/);
  });
});

function onboarded(features: readonly ProposedFeatureSwitch[]): Proposal {
  return proposalOf({
    kind: "project",
    project: {
      name: "Shop",
      path: "/code/shop",
      baseBranch: "main",
      mark: { label: "SH", colour: "teal" },
      installCommand: "npm ci",
      commands: [],
      installInputs: [],
      publishingMode: "merge",
      defaultPipeline: "quick-fix",
    },
    features: [...features],
    projectId: null,
    taskId: null,
  });
}

/** The proposed switches' fields, by their label: the badge's word and the reason. */
function featureFields(card: HTMLElement): string[] {
  return [...card.querySelectorAll(".proposal-field")]
    .filter((field) => field.querySelector(".proposal-feature"))
    .map((field) => field.textContent);
}

describe("ProposalCard on a Project to onboard", () => {
  it("shows each proposed feature switch On or Off with its reason, in the features' order", async () => {
    serviceReading({});
    const card = await cardOf(
      onboarded([
        { feature: "connected-devices", on: true, reason: "An Android app." },
        { feature: "github-issues", on: false, reason: "Its issues are tracked elsewhere." },
      ]),
    );

    expect(featureFields(card)).toEqual([
      "Connected devicesOnAn Android app.",
      "GitHub issuesOffIts issues are tracked elsewhere.",
    ]);
  });

  it("shows no switches for a Proposal that proposes none", async () => {
    serviceReading({});
    const card = await cardOf(onboarded([]));

    expect(card.textContent).toContain("Onboard Shop");
    expect(featureFields(card)).toEqual([]);
  });
});

describe("ProposalCard on the CTO's change of an Initiative's Pipeline", () => {
  const proposal = proposalOf({
    kind: "initiative",
    initiativeId: "9b0f7a51-3c2d-4e8f-a6b1-0c9d8e7f6a5b",
    edit: { kind: "pipeline", projectId: "the-office", pipelineId: "pp-linux" },
  });

  it("names the Project and that Project's own Project Pipeline it proposes", async () => {
    serviceReading({
      "/pipelines": [{ id: "full", name: "Full", description: "", stages: [TESTS] }],
      "/project-pipelines": [PP_LINUX],
    });
    const card = await cardOf(proposal);

    await vi.waitFor(() =>
      expect(card.textContent).toContain("Initiative's PipelineFull with Linux check"),
    );
    expect(card.textContent).toContain("Projectthe-office");
  });
});

function readingQueries(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(roleQueries.list().queryKey, [PLANNER, DEVOPS]);
  queryClient.setQueryData(dutyQueries.list().queryKey, [
    dutyOf("plans", "Plans", "planner", PLANNER),
    dutyOf("reviews", "Reviews", "planner", PLANNER),
  ]);
  return queryClient;
}

describe("ProposalCard on a change of duties", () => {
  const change: Proposal["change"] = {
    kind: "duties",
    from: { reviews: "planner", plans: "planner" },
    to: { plans: "devops", reviews: null },
  };

  it("shows each duty's holder as it was and as proposed, in the duties' order", async () => {
    serviceAnswering(proposalOf(change));
    const card = await cardOf(
      { ...proposalOf(change), draftedBy: "office-manager" },
      readingQueries(),
    );

    expect(card.textContent).toContain("Change duties");
    const rows = [...card.querySelectorAll(".proposal-changes li")].map(
      ({ textContent }) => textContent,
    );
    expect(rows).toEqual([
      "PlansAngela · PlannerDwight · Devops",
      "ReviewsAngela · PlannerNobodyPipelines whose Stages name it are flagged, and Start is refused.",
    ]);
    expect(card.textContent).toContain("Refused if it changes before you apply this");
  });

  it("applies, refreshing the duties", async () => {
    const fetched = serviceAnswering(proposalOf(change, { kind: "applied", at: AT, by: null }));
    const queryClient = readingQueries();
    const refreshed = vi.spyOn(queryClient, "invalidateQueries");
    const card = await cardOf(proposalOf(change), queryClient);

    await act(async () => {
      button(card, "Apply change").click();
      await vi.waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2));
    });

    expect(fetched).toHaveBeenCalledWith(
      `/api/proposals/${PROPOSAL_ID}/apply`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(refreshed).toHaveBeenCalledWith({ queryKey: dutyQueries.list().queryKey });
    expect(document.body.textContent).toContain("Duties changed.");
  });

  it("shows a refusal and stays open", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { message: "Plans was changed meanwhile, so this change no longer applies." },
          { status: 409 },
        ),
      ),
    );
    const card = await cardOf(proposalOf(change), readingQueries());

    await act(async () => {
      button(card, "Apply change").click();
      await vi.waitFor(() => expect(card.textContent).toContain("can't be applied yet"));
    });

    expect(card.textContent).toContain("Plans was changed meanwhile");
    expect(button(card, "Not now").disabled).toBe(false);
  });
});

/** The set-up card's duties table, a row's words each. */
function rowsOf(card: HTMLElement): string[] {
  return [...card.querySelectorAll(".proposal-setup-duties tbody tr")].map(
    ({ textContent }) => textContent,
  );
}

describe("ProposalCard on the set-up of The Office", () => {
  const planner = {
    roleKey: "planner",
    suggestedName: "Jan",
    card: {
      title: "Planner",
      responsibilities: "Writes each Task's Plan.",
      capabilities: { sharedMemory: true, chat: true, consultant: true, runEnvironment: false },
    },
    duties: ["plans"],
  } as unknown as Preset;
  const change: Extract<Proposal["change"], { kind: "office-setup" }> = {
    kind: "office-setup",
    hires: [
      { kind: "hire-from-preset", roleKey: "planner", name: "Jan" },
      {
        kind: "hire",
        roleKey: "data-analyst",
        card: {
          name: "Max",
          title: "Data Analyst",
          responsibilities: "Reads the numbers.",
          instructions: "Say where each number comes from.",
          engineSettings: {},
          capabilities: {
            sharedMemory: false,
            chat: true,
            consultant: false,
            runEnvironment: false,
          },
          permissionProfile: { edit: false, run: "read-only-git", web: true, mcpTools: {} },
          hardSwitches: {
            runInstalls: { kind: "never" },
            publishOutsideThePipeline: { kind: "never" },
            changeRoles: { kind: "never" },
            changeProjectSettings: { kind: "never" },
          },
          authority: {},
          taskLimit: "none",
          sessionDefault: "context-policy",
          skills: [],
        },
      },
    ],
    duties: [{ duty: "reviews", from: "reviewer", to: "data-analyst" }],
    hiredKeys: null,
  };

  /** A fresh Office: only the Caretaker, every duty at its default Role key. */
  function freshOffice(): QueryClient {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(roleQueries.list().queryKey, []);
    queryClient.setQueryData(roleCardQueries.presets().queryKey, [planner]);
    queryClient.setQueryData(dutyQueries.list().queryKey, [
      dutyOf("plans", "Plans", "planner", null),
      dutyOf("implements", "Implements", "developer", null),
      dutyOf("reviews", "Reviews", "reviewer", null),
    ]);
    return queryClient;
  }

  it("lists each hire, from the preset or from scratch, and every duty's holder after it", async () => {
    serviceAnswering(proposalOf(change));
    const card = await cardOf({ ...proposalOf(change), draftedBy: "caretaker" }, freshOffice());

    expect(card.textContent).toContain("Set up The Office");
    const hires = [...card.querySelectorAll(".proposal-setup-hire")].map(
      ({ textContent }) => textContent,
    );
    expect(hires).toEqual([
      "Jan · Plannerfrom the presetShared memoryChatConsultantWrites each Task's Plan.",
      "Max · Data Analystfrom scratchChatReads the numbers.",
    ]);
    expect(rowsOf(card)).toEqual([
      "PlansJan · Planner",
      "ImplementsNobodyPipelines whose Stages name it are flagged, and Start is refused.",
      "ReviewsMax · Data AnalystAssigned",
    ]);
    expect(button(card, "Hire 2 and assign duties")).toBeDefined();
    expect(button(card, "Not now")).toBeDefined();
  });

  it("applies, refreshing the people and the duties", async () => {
    const fetched = serviceAnswering(proposalOf(change, { kind: "applied", at: AT, by: null }));
    const queryClient = freshOffice();
    const refreshed = vi.spyOn(queryClient, "invalidateQueries");
    const card = await cardOf(proposalOf(change), queryClient);

    await act(async () => {
      button(card, "Hire 2 and assign duties").click();
      await vi.waitFor(() => expect(refreshed).toHaveBeenCalledTimes(3));
    });

    expect(fetched).toHaveBeenCalledWith(
      `/api/proposals/${PROPOSAL_ID}/apply`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(refreshed).toHaveBeenCalledWith({ queryKey: roleQueries.list().queryKey });
    expect(refreshed).toHaveBeenCalledWith({ queryKey: dutyQueries.list().queryKey });
    expect(document.body.textContent).toContain("The Office is set up.");
  });

  it("links each person hired once applied", async () => {
    const applied = proposalOf(
      { ...change, hiredKeys: ["planner", "data-analyst"] },
      { kind: "applied", at: AT, by: BY_YOU },
    );
    const queryClient = freshOffice();
    signIn(queryClient);
    const rootRoute = createRootRoute({
      component: () => (
        <ThreadDraftsProvider>
          <ChatProvider>
            <ToastProvider>
              <ProposalCard proposal={applied} />
            </ToastProvider>
          </ChatProvider>
        </ThreadDraftsProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const page = document.createElement("div");
    document.body.append(page);
    await act(async () => {
      const root = createRoot(page);
      mounted.push({ root, page });
      root.render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
      await router.load();
    });

    const links = [...page.querySelectorAll(".proposal-setup-hire a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["Jan · Planner", "/people/planner"],
      ["Max · Data Analyst", "/people/data-analyst"],
    ]);
    expect(page.textContent).toContain("Applied");
  });
});

/** The card inside the shell's router and chat, as a Thread shows it; and where the page went. */
async function routedCardOf(
  proposal: Proposal,
  /** Where the page opens, Now unless said. */
  at = "/now",
): Promise<{
  readonly card: HTMLElement;
  /** Where the page is now, its path and search. */
  readonly address: () => string;
}> {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ThreadDraftsProvider>
          <ChatProvider>
            <ToastProvider>
              <ProposalCard proposal={proposal} />
            </ToastProvider>
          </ChatProvider>
        </ThreadDraftsProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  const card = document.createElement("div");
  document.body.append(card);
  const root = createRoot(card);
  mounted.push({ root, page: card });
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return { card, address: () => router.state.location.href };
}

const FULL = { id: "full", name: "Full", description: "", stages: FULL_NOW };

describe("ProposalCard on a Pipeline's routes", () => {
  it("shows each changed Stage's routes as Was and Proposed, then Full as proposed with what was checked", async () => {
    serviceReading({ "/pipelines": [FULL], "/pipelines/check": { problems: [] } });
    const { card } = await routedCardOf(ROUTES_PROPOSAL);

    await vi.waitFor(() => expect(card.textContent).toContain("Change the Full Pipeline"));
    const labels = [...card.querySelectorAll(".proposal-change-label")].map(
      ({ textContent }) => textContent,
    );
    expect(labels).toEqual([
      "Stages",
      "Routes out of Tests",
      "Routes out of Review & fix",
      "Routes out of Verify on Linux",
      "Routes out of Docs",
    ]);
    const tests = card.querySelector('[aria-label="Proposed: routes out of Tests"]');
    expect(
      [...(tests?.querySelectorAll("li") ?? [])].map(({ textContent }) => textContent),
    ).toEqual(["→ Review & fix when Implement changed files", "→ Publish otherwise"]);
    expect(card.textContent).toContain("None: a new Stage");
    expect(card.textContent).toContain("None: the Stage is removed");

    const flow = card.querySelector('[aria-label="Full, as proposed"]');
    expect(flow?.querySelector('[aria-label="Flow"]')).not.toBeNull();
    expect(flow?.querySelectorAll(".flow-canvas-route-line--proposed")).toHaveLength(4);
    expect(flow?.querySelectorAll(".flow-canvas-route-line--taken-away")).toHaveLength(1);
    expect(flow?.textContent).toContain(
      "Checked: every Stage is reached, each has a route out, End can be reached from each, and every loop has a route with a limit.",
    );
    expect(flow?.querySelector("button")?.textContent).toMatch(/^Show it on the flow/);
  });

  it("opens the Pipeline in Settings › Pipelines with the Proposal on it from Show it on the flow", async () => {
    serviceReading({ "/pipelines": [FULL] });
    const { card, address } = await routedCardOf(ROUTES_PROPOSAL);

    await act(async () => button(card, "Show it on the flow").click());

    await vi.waitFor(() =>
      expect(address()).toBe(`/settings/pipelines/full?proposal=${ROUTES_PROPOSAL_ID}`),
    );
  });

  it("no longer offers Show it on the flow once answered", async () => {
    serviceReading({ "/pipelines": [FULL] });
    const { card } = await routedCardOf({
      ...ROUTES_PROPOSAL,
      status: { kind: "declined", at: AT, by: null, because: null },
    });

    expect(card.querySelector('[aria-label="Full, as proposed"]')).not.toBeNull();
    expect(card.textContent).not.toContain("Show it on the flow");
  });

  it("shows a Proposal drafted before routes as before: its Stages alone", async () => {
    serviceReading({ "/pipelines": [FULL] });
    const card = await cardOf({
      ...ROUTES_PROPOSAL,
      change: {
        kind: "pipeline",
        pipelineId: "full",
        from: FULL_NOW.slice(),
        to: FULL_PROPOSED.slice(),
        routes: null,
      },
    });

    await vi.waitFor(() => expect(card.textContent).toContain("Change the Full Pipeline"));
    expect(card.textContent).not.toContain("Routes out of");
    expect(card.textContent).not.toContain("as proposed");
  });
});

describe("ProposalCard linked to", () => {
  it("is marked while the address names its Proposal", async () => {
    serviceAnswering(officeInstructionsProposal("Be brief."));
    const { card } = await routedCardOf(
      officeInstructionsProposal("Be brief."),
      `/now?proposal=${PROPOSAL_ID}`,
    );

    const section = card.querySelector(".proposal-card");
    expect(section?.classList.contains("linked-to")).toBe(true);
    expect(section?.getAttribute("aria-current")).toBe("true");
  });

  it("isn't marked while the address names another Proposal, or none", async () => {
    serviceAnswering(officeInstructionsProposal("Be brief."));
    const { card: another } = await routedCardOf(
      officeInstructionsProposal("Be brief."),
      "/now?proposal=6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0a99",
    );
    const { card: none } = await routedCardOf(officeInstructionsProposal("Be brief."));

    for (const card of [another, none]) {
      const section = card.querySelector(".proposal-card");
      expect(section?.classList.contains("linked-to")).toBe(false);
      expect(section?.hasAttribute("aria-current")).toBe(false);
    }
  });
});

function roleCardProposal(editableCard: object | null, outOfDate = false): Proposal {
  return {
    id: PROPOSAL_ID,
    threadId: "6f1c2a52-1d0e-4a59-9d55-3c1f7f1f0a02",
    draftedBy: "office-manager",
    draftedAt: AT,
    change: {
      kind: "office-action",
      action: "change_role_card",
      title: "Change a Role card",
      subject: { kind: "role", id: "planner", title: "Angela" },
      fields: [],
      fingerprint: "abc",
      outOfDate,
      editableCard,
    },
    status: { kind: "open" },
  } as Proposal;
}

describe("ProposalCard on an Office action that has an editor", () => {
  it("offers Edit before applying for a Role card change it holds the card of", async () => {
    serviceAnswering(roleCardProposal({}));
    const card = await cardOf(roleCardProposal({}));

    expect(button(card, "Edit before applying")).toBeDefined();
    expect(button(card, "Apply change")).toBeDefined();
  });

  it("offers none for a Proposal with no card to edit, or once it is out of date", async () => {
    serviceAnswering(roleCardProposal(null));
    const plain = await cardOf(roleCardProposal(null));
    const stale = await cardOf(roleCardProposal({}, true));

    expect(plain.textContent).not.toContain("Edit before applying");
    expect(stale.textContent).not.toContain("Edit before applying");
  });
});
