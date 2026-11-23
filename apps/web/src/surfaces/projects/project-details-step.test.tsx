import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NewProject } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftFromSource, NEW_BASE_BRANCH, type ProjectSource } from "./add-project-source.ts";
import { ProjectDetailsStep } from "./project-details-step.tsx";
import type { ClonedRepository } from "./repository-clone-step.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT: NewProject = {
  name: "notes",
  path: "",
  baseBranch: NEW_BASE_BRANCH,
  mark: { label: "N", colour: "teal" },
  installCommand: "",
  commands: [],
  installInputs: [],
  publishingMode: "push-and-pull-request",
  defaultPipeline: "full",
};

function aClone(fields: Partial<ClonedRepository>): ClonedRepository {
  return {
    id: "clone-1",
    url: "https://github.com/office-user/notes.git",
    path: "/data/repositories/github.com/office-user/notes",
    startedAt: "2026-11-23T10:00:00.000Z",
    finishedAt: "2026-11-23T10:00:01.000Z",
    state: "cloned",
    defaultBranch: "main",
    branches: ["main", "develop"],
    empty: false,
    ...fields,
  };
}

const EMPTY_CLONE = aClone({ defaultBranch: null, branches: [], empty: true });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json([]))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function render(
  source: ProjectSource,
  draft: NewProject,
): {
  readonly changes: Partial<NewProject>[];
} {
  const changes: Partial<NewProject>[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ProjectDetailsStep
          formId="details"
          source={source}
          draft={draft}
          mark={draft.mark}
          installInputs=""
          runEnvironmentAnswer="decide-later"
          refusal={null}
          onChange={(fields) => changes.push(fields)}
          onMarkChange={() => undefined}
          onInstallInputsChange={() => undefined}
          onRunEnvironmentAnswerChange={() => undefined}
          onChangeSource={() => undefined}
          onSubmit={() => undefined}
        />
      </QueryClientProvider>,
    ),
  );
  return { changes };
}

function baseBranchField(): HTMLElement {
  const label = [...document.body.querySelectorAll("label")].find(
    (found) => found.textContent.trim() === "Base branch",
  );
  const field = label?.closest<HTMLElement>("div");
  if (!field) throw new Error("No Base branch field");
  return field;
}

describe("Add a Project, step 2: the Base branch", () => {
  it("is a text field starting at main for an empty clone, with a note on the first commit", () => {
    const source: ProjectSource = { whereItIs: "git-url", clone: EMPTY_CLONE };
    const draft = draftFromSource(DRAFT, source);
    const { changes } = render(source, draft);

    const input = baseBranchField().querySelector("input");
    expect(input?.value).toBe("main");
    expect(document.body.textContent).toContain(
      "The repository has no commits yet. Adding the Project makes main with an empty first commit and pushes it to the repository.",
    );

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(input, "trunk");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(changes).toContainEqual({ baseBranch: "trunk" });
  });

  it("picks among the branches of a clone with commits, with no note", () => {
    const source: ProjectSource = { whereItIs: "git-url", clone: aClone({}) };
    render(source, draftFromSource(DRAFT, source));

    expect(baseBranchField().querySelector("input")).toBeNull();
    expect(document.body.textContent).not.toContain("no commits yet");
  });
});
