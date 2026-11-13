import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Proposal, ProposalStatus, Stage } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { officeInstructionsQuery } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { ToastProvider } from "../toasts.tsx";
import { BY_ANN, BY_YOU, signIn } from "../user.fixtures.ts";
import { ProposalCard } from "./proposal-card.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function cardOf(proposal: Proposal, queryClient = new QueryClient()): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  mounted.push({ root, page });
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ProposalCard proposal={proposal} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

function button(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find(({ textContent }) =>
    textContent.includes(name),
  );
  if (!found) throw new Error(`The card has no ${name} button.`);
  return found;
}

describe("ProposalCard on the Office instructions", () => {
  it("says what it changes and shows the whole text with its line breaks", () => {
    serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
    const card = cardOf(officeInstructionsProposal(SEVERAL_LINES));
    expect(card.textContent).toContain("Change the Office instructions");
    expect(card.textContent).toContain("New Office instructions");
    expect(card.querySelector(".proposal-text")?.textContent).toBe(SEVERAL_LINES);
  });

  it("says they would be emptied when the new text is empty", () => {
    serviceAnswering(officeInstructionsProposal(""));
    const card = cardOf(officeInstructionsProposal(""));
    expect(card.textContent).toContain("the Office instructions would be emptied");
    expect(card.querySelector(".proposal-text")).toBeNull();
  });

  it("applies as the other Office settings do, refreshing the Office instructions", async () => {
    const fetched = serviceAnswering(
      officeInstructionsProposal(SEVERAL_LINES, { kind: "applied", at: AT, by: null }),
    );
    const queryClient = new QueryClient();
    const refreshed = vi.spyOn(queryClient, "invalidateQueries");
    const card = cardOf(officeInstructionsProposal(SEVERAL_LINES), queryClient);
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
    [{ kind: "declined", at: AT, by: null }, "Not applied"],
  ] satisfies [ProposalStatus, string][])("shows what became of it: %j", (status, words) => {
    serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
    const card = cardOf(officeInstructionsProposal(SEVERAL_LINES, status));
    expect(card.textContent).toContain(words);
    expect(card.querySelector(".proposal-text")?.textContent).toBe(SEVERAL_LINES);
    expect(card.querySelectorAll("button")).toHaveLength(0);
  });

  it.each([
    [{ kind: "applied", at: AT, by: BY_YOU }, "Applied", "by you"],
    [{ kind: "applied", at: AT, by: BY_ANN }, "Applied", "by Ann Lee"],
    [{ kind: "declined", at: AT, by: BY_YOU }, "Not applied", "by you"],
    [{ kind: "declined", at: AT, by: BY_ANN }, "Not applied", "by Ann Lee"],
  ] satisfies [ProposalStatus, string, string][])(
    "names the user who applied or declined it: %j",
    (status, badge, by) => {
      serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
      const queryClient = new QueryClient();
      signIn(queryClient);
      const card = cardOf(officeInstructionsProposal(SEVERAL_LINES, status), queryClient);
      expect(card.querySelector(".proposal-foot")?.textContent).toContain(badge);
      expect(card.querySelector(".proposal-foot .proposal-note")?.textContent).toMatch(
        new RegExp(`^${by} · `),
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

describe("ProposalCard on a Project Pipeline", () => {
  const newOne = proposalOf({
    kind: "project-pipeline",
    projectId: "the-office",
    pipelineId: null,
    from: null,
    to: {
      name: "Full with Linux check",
      description: "Then Linux.",
      basePipelineId: "full",
      stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: LINUX }],
    },
  });

  it("says it adds the Project Pipeline to its Project, with what the Project gets as the service builds it", async () => {
    serviceReading({
      "/projects": [],
      "/pipelines": [{ id: "full", name: "Full", description: "", stages: [TESTS], builtOnBy: [] }],
      "/project-pipelines/check": {
        problems: [],
        flags: [],
        rows: [
          {
            stage: TESTS,
            origin: "base",
            stageChangeIndexes: [],
            baseStage: TESTS,
            changedFields: [],
          },
          {
            stage: LINUX,
            origin: "inserted",
            stageChangeIndexes: [0],
            baseStage: null,
            changedFields: [],
          },
        ],
        stages: [TESTS, LINUX],
        broken: [],
      },
    });
    const card = cardOf(newOne);

    await vi.waitFor(() => expect(card.textContent).toContain("Tests → Verify on Linux"));
    expect(card.textContent).toContain("Add Full with Linux check to the-office's Pipelines");
    expect(card.textContent).toContain("Base PipelineFull");
    expect(card.textContent).toContain("Inserts Verify on Linux after Tests");
    expect(card.textContent).toContain("Refused if it changes before you apply this");
  });

  it("refreshes the Pipeline lists once applied, and says so", async () => {
    serviceReading({}, { ...newOne, status: { kind: "applied", at: AT, by: null } });
    const queryClient = new QueryClient();
    const refreshed = vi.spyOn(queryClient, "invalidateQueries");
    const card = cardOf(newOne, queryClient);

    await act(async () => {
      button(card, "Apply change").click();
      await vi.waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2));
    });

    expect(refreshed).toHaveBeenCalledWith({ queryKey: pipelineQueries.list().queryKey });
    expect(document.body.textContent).toContain(
      "Full with Linux check added to the-office's Pipelines.",
    );
  });

  it("titles a change by the Project Pipeline it changes", () => {
    serviceReading({});
    const fields = newOne.change.kind === "project-pipeline" ? newOne.change.to : undefined;
    if (!fields) throw new Error("A Project Pipeline Proposal.");
    const card = cardOf(
      proposalOf({
        kind: "project-pipeline",
        projectId: "the-office",
        pipelineId: "pp-linux",
        from: fields,
        to: { ...fields, description: "Linux, then publish." },
      }),
    );

    expect(card.textContent).toContain("Change the-office's Full with Linux check");
    expect(card.textContent).toContain("DescriptionThen Linux.Linux, then publish.");
  });
});

describe("ProposalCard on a library Pipeline's Stages", () => {
  const proposal = proposalOf({ kind: "pipeline", pipelineId: "full", from: [TESTS], to: [] });

  it("lists the Project Pipelines it would break while open, and still applies", async () => {
    serviceReading({
      "/pipelines": [{ id: "full", name: "Full", description: "", stages: [TESTS], builtOnBy: [] }],
      "/pipelines/check": {
        problems: [],
        flags: [],
        breaks: [
          {
            projectPipelineId: "pp-linux",
            name: "Full with Linux check",
            projectId: "the-office",
            projectName: "the-office",
            reasons: [
              {
                stageChangeIndex: 0,
                stageIndex: null,
                stageKey: "tests",
                text: "Inserts Verify on Linux after Tests, which Full no longer has.",
              },
            ],
          },
        ],
      },
    });
    const card = cardOf(proposal);

    await vi.waitFor(() =>
      expect(card.textContent).toContain("Applying this breaks 1 Project Pipeline"),
    );
    expect(card.textContent).toContain(
      "the-office › Full with Linux check: Inserts Verify on Linux after Tests, which Full no longer has.",
    );
    expect(button(card, "Apply anyway").disabled).toBe(false);
  });

  it("warns of nothing once it is applied", () => {
    serviceReading({
      "/pipelines": [{ id: "full", name: "Full", description: "", stages: [TESTS], builtOnBy: [] }],
    });
    const card = cardOf({ ...proposal, status: { kind: "applied", at: AT, by: null } });

    expect(card.textContent).not.toContain("breaks");
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
      "/pipelines": [{ id: "full", name: "Full", description: "", stages: [TESTS], builtOnBy: [] }],
      "/project-pipelines": [
        {
          id: "pp-linux",
          projectId: "the-office",
          name: "Full with Linux check",
          description: "",
          basePipeline: { id: "full", name: "Full" },
          stageChanges: [],
          rows: [],
          stages: [TESTS],
          broken: [],
        },
      ],
    });
    const card = cardOf(proposal);

    await vi.waitFor(() =>
      expect(card.textContent).toContain("Initiative's PipelineFull with Linux check"),
    );
    expect(card.textContent).toContain("Projectthe-office");
  });
});
