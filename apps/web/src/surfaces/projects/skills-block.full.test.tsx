import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, ProjectSkill } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import { ToastProvider } from "../../shell/toasts.tsx";
import { SkillsBlock } from "./skills-block.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT: Project = {
  id: "admin-panel",
  name: "Admin panel",
  path: "/projects/admin-panel",
  baseBranch: "main",
  mark: { label: "AP", colour: "teal" },
  installCommand: "",
  commands: [
    { key: "build", name: "Build", kind: "build", commandLine: "", rerunCommandLine: "" },
    { key: "lint", name: "Lint", kind: "lint", commandLine: "", rerunCommandLine: "" },
    { key: "test", name: "Test", kind: "test", commandLine: "", rerunCommandLine: "" },
  ],
  installInputs: [],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
  beforePublishingCommand: "",
  afterPublishingCommand: "",
  deleteMergedBranches: false,
  environment: { set: [], unset: [], prependPath: [] },
  useProjectSkills: true,
  projectSkillsOff: [],
  projectDefault: null,
  useForEveryRole: false,
  roleOverrides: [],
  runEnvironment: "not-decided",
  projectLimit: 1,
  addedAt: "2026-11-01T10:00:00.000Z",
  codeHost: null,
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  issueSettings: {
    autoImportLabel: null,
    closeOnDone: true,
    commentOnStartAndDone: false,
    closeOnDrop: false,
  },
};

function aProjectSkill(key: string, path: string, usesInLast7Days: number): ProjectSkill {
  return {
    key,
    name: key,
    description: "",
    path,
    listedAtStart: true,
    alsoInLibrary: false,
    usesInLast7Days,
  };
}

/** The Project's Skills section over a page of its own, its skills answered as given. */
function blockWith(skills: readonly ProjectSkill[]): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(projectQueries.skills(PROJECT.id).queryKey, [...skills]);
  const page = document.createElement("div");
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SkillsBlock project={PROJECT} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return page;
}

function rowText(page: HTMLElement, path: string): string {
  const row = [...page.querySelectorAll(".project-skill")].find(
    (skill) => skill.querySelector(".project-skill-path")?.textContent === path,
  );
  if (!row) throw new Error(`No row for ${path}.`);
  return row.textContent;
}

describe("a Project's skills, their uses", () => {
  it("shows each row's uses in the Project in the last 7 days", () => {
    const page = blockWith([
      aProjectSkill("lint", ".claude/skills/lint", 0),
      aProjectSkill("release", ".claude/commands/release.md", 1),
      aProjectSkill("tdd", ".claude/skills/tdd", 5),
    ]);

    expect(rowText(page, ".claude/skills/lint")).toContain("Not used in the last 7 days");
    expect(rowText(page, ".claude/commands/release.md")).toContain("Used once in the last 7 days");
    expect(rowText(page, ".claude/skills/tdd")).toContain("Used 5 times in the last 7 days");
  });

  it("shows the same count on two rows that share a key", () => {
    const page = blockWith([
      aProjectSkill("deploy", ".claude/skills/deploy", 3),
      aProjectSkill("deploy", "apps/web/.claude/skills/deploy", 3),
    ]);

    expect(rowText(page, ".claude/skills/deploy")).toContain("Used 3 times in the last 7 days");
    expect(rowText(page, "apps/web/.claude/skills/deploy")).toContain(
      "Used 3 times in the last 7 days",
    );
  });
});
