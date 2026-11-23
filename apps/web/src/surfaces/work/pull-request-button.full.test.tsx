import type { StageRun, TaskStage } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { pullRequestAction } from "./pull-request-button.tsx";
import { RecordActionButton } from "./record-actions.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PULL_REQUEST_URL = "https://github.com/office/app/pull/7";

function published(pullRequestUrl: string | null, skipped = false): StageRun["outcome"] {
  return {
    status: "done",
    summary: "Published.",
    skipped,
    definitionOfDoneMet: null,
    pullRequestUrl,
    publishResult: null,
    handoverNote: null,
  };
}

/** A Publish Stage with a run for each outcome, oldest first. */
function publishStage(...outcomes: readonly StageRun["outcome"][]): TaskStage {
  return {
    stage: { kind: "publish", key: "publish", name: "Publish", optional: false },
    state: "done",
    tokens: NO_TOKENS,
    wentBack: null,
    runs: outcomes.map((outcome, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      number: index + 1,
      startedAt: "2026-11-01T10:00:00.000Z",
      endedAt: outcome === null ? null : "2026-11-01T10:01:00.000Z",
      waitingSince: null,
      threadId: null,
      session: null,
      engine: null,
      engineSwitches: [],
      tokens: NO_TOKENS,
      context: null,
      carriedFailure: null,
      route: null,
      sentBack: null,
      commandRuns: [],
      gateAction: null,
      outcome,
    })),
  };
}

function linkOf(taskStage: TaskStage): HTMLAnchorElement | null {
  const page = document.createElement("div");
  const action = pullRequestAction([taskStage]);
  act(() => createRoot(page).render(action && <RecordActionButton action={action} />));
  return page.querySelector("a");
}

describe("the head's pull request button", () => {
  it("links to the pull request the Task's Publish opened, in a new tab", () => {
    const link = linkOf(publishStage(published(PULL_REQUEST_URL)));
    expect(link?.textContent).toContain("Open pull request");
    expect(link?.getAttribute("href")).toBe(PULL_REQUEST_URL);
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  it("isn't there on an older run, which kept no pull request", () => {
    expect(linkOf(publishStage(published(null)))).toBeNull();
  });

  it("stays while Publish goes again or is skipped, as the pull request is still open", () => {
    expect(linkOf(publishStage(published(PULL_REQUEST_URL), null))).not.toBeNull();
    expect(linkOf(publishStage(published(PULL_REQUEST_URL), published(null, true)))).not.toBeNull();
  });
});
