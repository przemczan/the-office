import type { StageRun, TaskStage } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { PullRequestButton } from "./pull-request-button.tsx";

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
    handoverNote: null,
  };
}

/** A Publish Stage with a run for each outcome, oldest first. */
function publishStage(...outcomes: readonly StageRun["outcome"][]): TaskStage {
  return {
    stage: { kind: "script", key: "publish", name: "Publish", optional: false, command: "publish" },
    state: "done",
    tokens: NO_TOKENS,
    wentBack: null,
    runs: outcomes.map((outcome, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      number: index + 1,
      startedAt: "2026-11-01T10:00:00.000Z",
      endedAt: outcome === null ? null : "2026-11-01T10:01:00.000Z",
      threadId: null,
      session: null,
      tokens: NO_TOKENS,
      carriedFailure: null,
      sentBack: null,
      commandRuns: [],
      gateAction: null,
      outcome,
    })),
  };
}

function buttonOf(taskStage: TaskStage): HTMLButtonElement | null {
  const page = document.createElement("div");
  act(() => createRoot(page).render(<PullRequestButton taskStages={[taskStage]} />));
  return page.querySelector("button");
}

describe("the head's pull request button", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the pull request the Task's Publish opened", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const button = buttonOf(publishStage(published(PULL_REQUEST_URL)));
    expect(button?.textContent).toContain("Open pull request");
    act(() => button?.click());
    expect(open).toHaveBeenCalledWith(PULL_REQUEST_URL, "_blank", "noopener,noreferrer");
  });

  it("isn't there on an older run, which kept no pull request", () => {
    expect(buttonOf(publishStage(published(null)))).toBeNull();
  });

  it("stays while Publish goes again or is skipped, as the pull request is still open", () => {
    expect(buttonOf(publishStage(published(PULL_REQUEST_URL), null))).not.toBeNull();
    expect(
      buttonOf(publishStage(published(PULL_REQUEST_URL), published(null, true))),
    ).not.toBeNull();
  });
});
