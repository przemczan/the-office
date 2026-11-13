import type { Stage, TaskStage } from "@the-office/contracts";
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

function walked(states: readonly TaskStage["state"][]): TaskStage[] {
  return STAGES.map((stage, index) => ({
    stage,
    state: states[index] ?? "pending",
    tokens: NO_TOKENS,
    wentBack: null,
    runs: [],
  }));
}

/** The track at a width its `ResizeObserver` measures, as the browser would. */
function renderedAt(width: number, stages: readonly TaskStage[], placeholder = false): HTMLElement {
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
        placeholder={placeholder}
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
    const page = renderedAt(480, walked([]), true);

    const track = trackOf(page);
    expect(track.className).toContain("initiative-track-placeholder");
    expect(track.querySelector("button")).toBeNull();
  });
});
