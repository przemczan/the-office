import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { roleQueries } from "../../../api/people.ts";
import { skillQueries } from "../../../api/skills.ts";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { WhoHasItDialog } from "./who-has-it-dialog.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function aSkill(name: string): Skill {
  return {
    name,
    description: `What ${name} does.`,
    source: "written",
    version: 1,
    filesHash: "hash",
    state: "on",
    everyone: false,
    roles: [],
    addedAt: "2026-11-01T10:00:00.000Z",
    savedAt: "2026-11-01T10:00:00.000Z",
    usesInLast7Days: 0,
  };
}

let root: Root | undefined;
let page: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  page?.remove();
});

/** Settings › Skills › Assign… for the skill named, its queries answered. */
function dialogFor(name: string): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(skillQueries.list().queryKey, [aSkill(name)]);
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  page = document.createElement("div");
  document.body.append(page);
  const shown = createRoot(page);
  root = shown;
  act(() =>
    shown.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WhoHasItDialog name={name} onClose={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return document.body.textContent;
}

describe("Who has a skill", () => {
  it("warns that a skill named like an Office command can't run as a skill command", () => {
    expect(dialogFor("help")).toContain(
      "/help is an Office command, so the skill can't run as a skill command.",
    );
  });

  it("warns of nothing for any other skill", () => {
    expect(dialogFor("review-pr")).not.toContain("is an Office command");
  });
});
