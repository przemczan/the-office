import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Proposal, ProposalStatus } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { officeInstructionsQuery } from "../../api/conversations.ts";
import { ToastProvider } from "../toasts.tsx";
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
      officeInstructionsProposal(SEVERAL_LINES, { kind: "applied", at: AT }),
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
    [{ kind: "applied", at: AT }, "Applied"],
    [{ kind: "declined", at: AT }, "Not applied"],
  ] satisfies [ProposalStatus, string][])("shows what became of it: %j", (status, words) => {
    serviceAnswering(officeInstructionsProposal(SEVERAL_LINES));
    const card = cardOf(officeInstructionsProposal(SEVERAL_LINES, status));
    expect(card.textContent).toContain(words);
    expect(card.querySelector(".proposal-text")?.textContent).toBe(SEVERAL_LINES);
    expect(card.querySelectorAll("button")).toHaveLength(0);
  });
});
