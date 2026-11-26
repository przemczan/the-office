import type { Stage, StageRun, TaskStage, TaskState } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { InitiativePipelineTrack } from "./initiative-pipeline-track.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STAGES: readonly Stage[] = ["Integrate", "Check", "Review", "Publish", "Tidy"].map(
  (name): Stage => ({
    kind: "script",
    key: name.toLowerCase(),
    name,
    optional: false,
    command: name.toLowerCase(),
  }),
);

function aRun(number: number, route: StageRun["route"] = null): StageRun {
  return {
    id: `8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e${number.toString().padStart(2, "0")}`,
    number,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    waitingSince: null,
    threadId: null,
    session: null,
    engine: null,
    engineSwitches: [],
    tokens: NO_TOKENS,
    context: null,
    carriedFailure: null,
    route,
    choice: null,
    sentBack: null,
    restart: null,
    restarted: null,
    startedOver: null,
    earlierStart: false,
    gateAction: null,
    commandRuns: [],
    outcome: null,
  };
}

/** The Stages walked in Pipeline order, each Stage not pending having run once. */
function walked(states: readonly TaskStage["state"][]): TaskStage[] {
  return STAGES.map((stage, index) => {
    const state = states[index] ?? "pending";
    return {
      stage,
      state,
      tokens: NO_TOKENS,
      wentBack: null,
      runs: state === "pending" ? [] : [aRun(index + 1)],
    };
  });
}

/**
 * Integrate, Check, Review (back to Check), Check again and running: Review was reached before
 * Check's second round, so the track goes Integrate, Check, Review, then Publish and Tidy ahead.
 */
function loopedBack(): TaskStage[] {
  const [integrate, check, review, publish, tidy] = walked([]);
  return [
    { ...integrate!, state: "done", runs: [aRun(1, { to: "check", times: 1, limit: null })] },
    {
      ...check!,
      state: "running",
      runs: [aRun(2, { to: "review", times: 1, limit: null }), { ...aRun(4), endedAt: null }],
    },
    { ...review!, state: "done", runs: [aRun(3, { to: "check", times: 1, limit: null })] },
    publish!,
    tidy!,
  ];
}

/** The track at a width its `ResizeObserver` measures, as the browser would. */
function renderedAt(
  width: number,
  stages: readonly TaskStage[],
  publishingTaskState: TaskState | null = "in-progress",
): HTMLElement {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <InitiativePipelineTrack
        label="Ship it in not-astray"
        stages={stages}
        publishingTaskState={publishingTaskState}
        roles={[]}
        commands={[]}
        selectedKey={undefined}
        stageElementId={(key) => `stage-${key}`}
        onSelect={() => undefined}
      />,
    ),
  );
  return page;
}

function trackOf(page: HTMLElement): HTMLElement {
  const track = page.querySelector<HTMLElement>(
    '[role="group"][aria-label="Ship it in not-astray"]',
  );
  if (!track) throw new Error("There is no track.");
  return track;
}

describe("a Project's track", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("lies across when its width gives each Stage 96 pixels, green as far as it got", () => {
    const page = renderedAt(480, walked(["done", "done", "running"]));

    const track = trackOf(page);
    expect(track.dataset["layout"]).toBe("across");
    expect(track.querySelectorAll(".initiative-track-cells > li")).toHaveLength(5);
    expect(track.querySelector(".initiative-track-reached-live")).not.toBeNull();
    expect(track.querySelector('[aria-current="step"]')?.textContent).toContain("Review");
    expect(track.querySelector(".pipeline-rail-now")?.closest("li")?.textContent).toContain(
      "Review",
    );
  });

  it("goes in the order the Stages ran, a Stage the work came back to once with its round", () => {
    const page = renderedAt(480, loopedBack());

    const track = trackOf(page);
    const cells = [...track.querySelectorAll(".initiative-track-cells > li")];
    expect(cells.map((cell) => cell.querySelector(".initiative-track-name")?.textContent)).toEqual([
      "Integrate",
      "Check",
      "Review",
      "Publish",
      "Tidy",
    ]);
    expect(cells[1]?.querySelector('[aria-current="step"]')).not.toBeNull();
    expect(cells[1]?.querySelector(".pipeline-rail-now")?.textContent).toBe("Now");
    expect(cells[1]?.querySelector(".pipeline-rail-round")?.textContent).toContain("Round 2");
    expect(track.querySelectorAll(".pipeline-rail-round")).toHaveLength(1);
    expect(track.querySelector(".initiative-track-reached")?.getAttribute("style")).toContain(
      "width: 40%",
    );
  });

  it("says a stacked Stage's round in its row, beside its name", () => {
    const page = renderedAt(358, loopedBack());

    const rows = [...trackOf(page).querySelectorAll(".initiative-track-rows > li")];
    expect(rows[1]?.querySelector(".initiative-track-name")?.textContent).toBe("Check · Round 2");
    expect(rows[1]?.querySelector(".pipeline-rail-now")).not.toBeNull();
    expect(rows[2]?.className).toContain("initiative-track-reached-above");
    expect(rows[3]?.className).not.toContain("initiative-track-reached-above");
  });

  it("stacks a Stage a row when it can't, the line green down to the Stage reached", () => {
    const page = renderedAt(358, walked(["done", "failed"]));

    const track = trackOf(page);
    expect(track.dataset["layout"]).toBe("stacked");
    const rows = [...track.querySelectorAll(".initiative-track-rows > li")];
    expect(rows).toHaveLength(5);
    expect(rows[0]?.className).toContain("initiative-track-reached-below");
    expect(rows[1]?.className).toContain("initiative-track-reached-above");
    expect(rows[1]?.textContent).toContain("Check");
    expect(rows[1]?.textContent).toContain("Failed");
    expect(rows[2]?.className).not.toContain("initiative-track-reached-above");
  });

  it("before any Publishing Task is dashed with nothing to select", () => {
    const page = renderedAt(480, walked([]), null);

    const track = trackOf(page);
    expect(track.className).toContain("initiative-track-placeholder");
    expect(track.querySelector("button")).toBeNull();
    expect(track.querySelector(".pipeline-rail-now")).toBeNull();
  });
});
