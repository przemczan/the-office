import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Duty, Role } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dutyQueries, roleQueries } from "../api/people.ts";
import { AskDevopsButton } from "./ask-devops.tsx";
import { ThreadDraftsProvider } from "./conversation/thread-drafts.tsx";
import { aDuty } from "./duties.fixtures.ts";

// The chat lives in the shell, over the router; asking only opens it.
vi.mock("./chat/use-chat.tsx", () => ({ useChat: () => ({ open: vi.fn<() => void>() }) }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPS = {
  key: "ops",
  builtIn: false,
  letGoAt: null,
  card: { name: "Nina", capabilities: { chat: true } },
} as unknown as Role;

afterEach(() => document.body.replaceChildren());

function rendered(duties: readonly Duty[]): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(roleQueries.list().queryKey, [OPS]);
  queryClient.setQueryData(dutyQueries.list().queryKey, [...duties]);
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ThreadDraftsProvider>
          <AskDevopsButton label={(name) => `Ask ${name}`} draft="Set up the commands." />
        </ThreadDraftsProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

describe("AskDevopsButton", () => {
  it("asks whoever holds Onboards and repairs Projects, whatever their Role's key", () => {
    const page = rendered([aDuty("onboards-projects", "ops")]);

    const buttons = [...page.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    // The button's loading spinner carries its own style after the words.
    expect(buttons[0]?.textContent.replace(/@keyframes.*$/s, "")).toBe("Ask Nina");
    expect(page.textContent).not.toContain("Nobody holds");
  });

  it("offers no button while nobody holds it, saying so and where to choose who", () => {
    const page = rendered([aDuty("onboards-projects", null, "caretaker")]);

    expect(page.querySelector("button")).toBeNull();
    expect(page.textContent).toBe(
      "Nobody holds Onboards and repairs Projects, so the Caretaker stands in meanwhile. Choose who in Settings › Duties.",
    );
  });
});
