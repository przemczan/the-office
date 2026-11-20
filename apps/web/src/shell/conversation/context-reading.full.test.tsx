import type { Thread } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ContextReading } from "./context-reading.tsx";
import { threadReadingLook } from "./context-reading-words.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function aThread(
  fields: Partial<Pick<Thread, "stageThread" | "stageContextLimits">>,
): Pick<Thread, "context" | "state" | "stageThread" | "stageContextLimits"> {
  return {
    state: "answering",
    stageThread: true,
    stageContextLimits: null,
    context: {
      move: "resume",
      reason: "cache-warm",
      cacheWarm: true,
      cacheWarmUntil: null,
      contextTokens: 41_000,
      contextWindow: 200_000,
      contextReported: true,
      briefTokens: null,
      alternatives: [],
      override: null,
    },
    ...fields,
  };
}

/** The meter's marks: each one's limit, if it is one, and where it stands. */
function marks(thread: ReturnType<typeof aThread>): { limit?: string; left: string }[] {
  const page = document.createElement("div");
  const root = createRoot(page);
  act(() => root.render(<ContextReading look={threadReadingLook(thread, "Jim")} />));
  const found = [...page.querySelectorAll<HTMLElement>(".context-meter-mark")].map((mark) => ({
    ...(mark.dataset.limit === undefined ? {} : { limit: mark.dataset.limit }),
    left: mark.style.left,
  }));
  act(() => root.unmount());
  return found;
}

describe("the context meter's marks", () => {
  it("marks a Stage Thread's soft and hard limits where they stand in the window", () => {
    expect(marks(aThread({ stageContextLimits: { soft: 100_000, hard: 180_000 } }))).toEqual([
      { limit: "Soft limit 100k", left: "50%" },
      { limit: "Hard limit 180k", left: "90%" },
    ]);
  });

  it("marks nothing on a Stage Thread without limits", () => {
    expect(marks(aThread({ stageContextLimits: null }))).toEqual([]);
  });

  it("keeps a chat's one hand-over mark", () => {
    expect(marks(aThread({ stageThread: false }))).toEqual([{ left: "" }]);
  });
});
