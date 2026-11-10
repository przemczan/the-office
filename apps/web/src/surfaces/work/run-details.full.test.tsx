import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment, Stage, StageRun, TaskStage } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { attachmentQueries } from "../../api/work.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { RunDetails } from "./run-details.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK_ID = "00000000-0000-4000-8000-000000000001";
const gate: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };

function aRun(fields: Pick<StageRun, "id" | "number" | "startedAt" | "endedAt">): StageRun {
  return {
    waitingSince: null,
    threadId: null,
    session: null,
    tokens: NO_TOKENS,
    carriedFailure: null,
    sentBack: null,
    commandRuns: [],
    gateAction: null,
    outcome: {
      status: "done",
      summary: "The Task reached the Gate and waited for the user.",
      skipped: false,
      definitionOfDoneMet: null,
      pullRequestUrl: null,
      handoverNote: null,
    },
    ...fields,
  };
}

const firstRun: StageRun = {
  ...aRun({
    id: "00000000-0000-4000-8000-00000000000a",
    number: 1,
    startedAt: "2026-11-04T10:00:00.000Z",
    endedAt: "2026-11-04T11:00:00.000Z",
  }),
  gateAction: { kind: "continue" },
};
const secondRun = aRun({
  id: "00000000-0000-4000-8000-00000000000b",
  number: 2,
  startedAt: "2026-11-04T11:20:00.000Z",
  endedAt: "2026-11-04T11:20:00.100Z",
});
const gateStage: TaskStage = {
  stage: gate,
  state: "waiting-on-you",
  tokens: NO_TOKENS,
  wentBack: null,
  runs: [firstRun, secondRun],
};

function anAttachment(
  kind: Attachment["kind"],
  name: string,
  addedAt: string,
  mediaType: string,
): Attachment {
  return {
    kind,
    id: crypto.randomUUID(),
    owner: { kind: "task", taskId: TASK_ID },
    name,
    addedBy: { kind: "person", roleKey: "developer" },
    addedAt,
    mediaType,
    size: 1024,
    text: kind === "document",
  } as Attachment;
}

function showRun(run: StageRun, attachments: readonly Attachment[]): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(
    attachmentQueries.of({ kind: "task", taskId: TASK_ID }).queryKey,
    attachments as Attachment[],
  );
  const page = document.createElement("div");
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <RunDetails
          taskId={TASK_ID}
          stages={[gateStage]}
          taskStage={gateStage}
          run={run}
          tab="summary"
          roles={[]}
          names={(key) => key}
          now={new Date("2026-11-04T13:00:00.000Z")}
          onTab={() => undefined}
          onReadSummary={() => undefined}
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    ),
  );
  return page;
}

function shownIn(page: HTMLElement): HTMLElement | null {
  return page.querySelector('[aria-label="Attachments"]');
}

function thumbnail(page: HTMLElement, name: string): Element | null {
  return page.querySelector(`[aria-label="View ${name}"]`);
}

describe("a Gate's run", () => {
  const attachments = [
    anAttachment("image", "first.png", "2026-11-04T10:30:00.000Z", "image/png"),
    anAttachment("image", "second.png", "2026-11-04T11:30:00.000Z", "image/png"),
    anAttachment("document", "notes.md", "2026-11-04T11:40:00.000Z", "text/markdown"),
  ];

  it("shows the Attachments of that run alone, each of the Gate's runs its own", () => {
    const first = showRun(firstRun, attachments);
    expect(thumbnail(first, "first.png")).not.toBeNull();
    expect(thumbnail(first, "second.png")).toBeNull();
    expect(shownIn(first)?.textContent).not.toContain("notes.md");

    const second = showRun(secondRun, attachments);
    expect(thumbnail(second, "first.png")).toBeNull();
    expect(thumbnail(second, "second.png")).not.toBeNull();
    expect(shownIn(second)?.textContent).toContain("notes.md");
  });

  it("shows no Attachments heading for a run that has none", () => {
    expect(shownIn(showRun(secondRun, attachments.slice(0, 1)))).toBeNull();
  });
});
