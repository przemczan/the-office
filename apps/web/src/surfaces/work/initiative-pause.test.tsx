import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Initiative } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import {
  InitiativePausedBadge,
  InitiativePauseButton,
  pausedWords,
  resumedWords,
} from "./initiative-pause.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACTIVE: Initiative = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  name: "Usage exports",
  outcome: "",
  state: "active",
  originIdeaId: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  projectIds: [],
  createdBy: { kind: "user" },
  createdAt: "2026-11-10T09:00:00.000Z",
  endedAt: null,
  archivedAt: null,
  pausedAt: null,
  planningThreadId: null,
  planningAutoMode: false,
  pipelines: [],
  shortName: null,
  branches: [],
};
const PAUSED: Initiative = { ...ACTIVE, pausedAt: "2026-11-12T12:00:00.000Z" };

async function rendered(node: ReactNode): Promise<HTMLElement> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{node}</ToastProvider>
      </QueryClientProvider>,
    );
  });
  return page;
}

/** Each button's words, without the styles a Button carries with it. */
function buttonLabels(page: HTMLElement): string[] {
  return [...page.querySelectorAll("button")].map((button) => {
    const words = button.cloneNode(true) as HTMLElement;
    for (const style of words.querySelectorAll("style")) style.remove();
    return words.textContent.trim();
  });
}

describe("Pause and Resume the Initiative on its page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(Response.json({}, { status: 404 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("offers Pause the Initiative while it is active and not paused", async () => {
    const page = await rendered(<InitiativePauseButton initiative={ACTIVE} />);

    expect(buttonLabels(page)).toEqual(["Pause the Initiative"]);
  });

  it("offers Resume the Initiative while it is paused", async () => {
    const page = await rendered(<InitiativePauseButton initiative={PAUSED} />);

    expect(buttonLabels(page)).toEqual(["Resume the Initiative"]);
  });

  it("offers neither while it is shaping or has ended", async () => {
    for (const state of ["shaping", "done", "dropped"] as const) {
      const page = await rendered(<InitiativePauseButton initiative={{ ...ACTIVE, state }} />);

      expect(buttonLabels(page)).toEqual([]);
    }
  });

  it("shows the Paused badge only while it is paused", async () => {
    const paused = await rendered(<InitiativePausedBadge initiative={PAUSED} />);
    const active = await rendered(<InitiativePausedBadge initiative={ACTIVE} />);

    expect(paused.textContent).toBe("Paused");
    expect(active.textContent).toBe("");
  });
});

describe("the Pause and Resume toasts", () => {
  it("say how many Tasks were paused or resumed, and when the fire alarm holds them", () => {
    expect(pausedWords(2)).toBe(
      "Initiative paused: 2 Tasks paused. None of its Tasks starts until you resume it.",
    );
    expect(pausedWords(0)).toBe(
      "Initiative paused: none of its Tasks was running. None of its Tasks starts until you resume it.",
    );
    expect(resumedWords(1, false)).toBe("Initiative resumed: 1 Task resumed.");
    expect(resumedWords(1, true)).toBe(
      "Initiative resumed: 1 Task goes on at the fire alarm's all clear.",
    );
    expect(resumedWords(0, false)).toBe("Initiative resumed: its Tasks may start again.");
  });
});
