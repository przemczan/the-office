import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { roleQueries } from "../../../api/people.ts";
import { skillQueries } from "../../../api/skills.ts";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { ToastProvider } from "../../../shell/toasts.tsx";
import { SkillsSection } from "./skills-section.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function aSkill(name: string, usesInLast7Days: number): Skill {
  return {
    name,
    description: `What ${name} does.`,
    source: "written",
    version: 1,
    filesHash: "hash",
    state: "on",
    everyone: true,
    roles: [],
    addedAt: "2026-11-01T10:00:00.000Z",
    savedAt: "2026-11-01T10:00:00.000Z",
    usesInLast7Days,
  };
}

/** Settings › Skills over a page of its own, its queries answered as given. */
function sectionWith(skills: readonly Skill[]): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(skillQueries.list().queryKey, [...skills]);
  queryClient.setQueryData(roleQueries.list().queryKey, []);
  const page = document.createElement("div");
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PageHeadingProvider setPageHeading={() => undefined}>
            <SkillsSection />
          </PageHeadingProvider>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

/** Each row's skill name with what its Uses cell shows and what it reads in full. */
function usesByRow(page: HTMLElement): readonly (readonly [string, string, string])[] {
  return [...page.querySelectorAll("tbody tr")].map((row) => {
    const uses = row.querySelector(".skill-uses");
    return [
      row.querySelector(".skill-chip")?.textContent ?? "",
      uses?.querySelector("[aria-hidden='true']")?.textContent ?? "",
      uses?.querySelector(".visually-hidden")?.textContent ?? "",
    ] as const;
  });
}

describe("Settings › Skills, the Uses column", () => {
  it("shows each skill's uses in the last 7 days as the service gives them", () => {
    const page = sectionWith([aSkill("deploy", 0), aSkill("review", 1), aSkill("tdd", 12)]);

    expect(page.querySelector("thead")?.textContent).toContain("Uses");
    expect(usesByRow(page)).toEqual([
      ["deploy", "0", "Not used in the last 7 days"],
      ["review", "1", "Used once in the last 7 days"],
      ["tdd", "12", "Used 12 times in the last 7 days"],
    ]);
  });
});
