import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GitHubRepository, GitHubState, Project } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitHubQueries } from "../../api/github.ts";
import { projectQueries } from "../../api/projects.ts";
import { GitHubRepositoryPicker } from "./github-repository-picker.tsx";
import type { RepositoryCloning } from "./repository-clone-step.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SIGNED_IN: GitHubState = {
  status: "signed-in",
  app: { slug: "the-office", owner: "office-user", installUrl: "https://github.com/apps/x" },
  login: "office-user",
};

function aRepository(name: string): GitHubRepository {
  return {
    fullName: `office-user/${name}`,
    repositoryUrl: `https://github.com/office-user/${name}.git`,
    private: false,
    defaultBranch: "main",
    pushedAt: "2026-11-05T10:00:00Z",
    description: `About ${name}`,
  };
}

const NOTES = aRepository("notes");
const SHOP = aRepository("shop");

const IDLE: RepositoryCloning = {
  start: () => undefined,
  refusal: null,
  clone: undefined,
  url: undefined,
  busy: false,
  forget: () => undefined,
};

afterEach(() => {
  document.body.replaceChildren();
});

/** The picker over the repositories, already read, and the picked one held as the dialog does. */
function picker(cloning: RepositoryCloning = IDLE): {
  render: (cloning: RepositoryCloning) => void;
  onPick: ReturnType<typeof vi.fn<(repository: GitHubRepository) => void>>;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(gitHubQueries.state().queryKey, SIGNED_IN);
  queryClient.setQueryData(gitHubQueries.repositories().queryKey, [NOTES, SHOP]);
  queryClient.setQueryData(projectQueries.list().queryKey, [] as Project[]);
  const page = document.createElement("div");
  document.body.append(page);
  const root: Root = createRoot(page);
  let picked: GitHubRepository | undefined;
  let current = cloning;
  const onPick = vi.fn<(repository: GitHubRepository) => void>((repository) => {
    picked = repository;
    render(current);
  });
  const render = (next: RepositoryCloning): void => {
    current = next;
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitHubRepositoryPicker
            cloning={next}
            picked={picked}
            onPick={onPick}
            onUseGitUrl={() => undefined}
          />
        </QueryClientProvider>,
      ),
    );
  };
  render(cloning);
  return { render, onPick };
}

function row(repository: GitHubRepository): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[aria-label="${repository.fullName}"]`);
  if (!found) throw new Error(`No row for ${repository.fullName}`);
  return found;
}

describe("From GitHub's repository list", () => {
  it("picks a repository on a click and starts no clone", () => {
    const start = vi.fn<RepositoryCloning["start"]>();
    const { onPick } = picker({ ...IDLE, start });

    expect(row(NOTES).getAttribute("aria-pressed")).toBe("false");
    act(() => row(NOTES).click());

    expect(onPick).toHaveBeenCalledWith(NOTES);
    expect(start).not.toHaveBeenCalled();
    expect(row(NOTES).getAttribute("aria-pressed")).toBe("true");
    expect(row(NOTES).classList).toContain("selected");
    expect(row(NOTES).textContent).not.toContain("Clone");
    expect(row(NOTES).hasAttribute("title")).toBe(false);
  });

  it("moves the pick to the row clicked next", () => {
    picker();

    act(() => row(NOTES).click());
    act(() => row(SHOP).click());

    expect(row(NOTES).getAttribute("aria-pressed")).toBe("false");
    expect(row(NOTES).classList).not.toContain("selected");
    expect(row(SHOP).getAttribute("aria-pressed")).toBe("true");
    expect(row(SHOP).classList).toContain("selected");
  });

  it("shows a clone's progress in its row, the others held meanwhile", () => {
    const { render } = picker();
    act(() => row(NOTES).click());

    render({ ...IDLE, url: NOTES.repositoryUrl, busy: true });

    expect(row(NOTES).getAttribute("role")).toBe("group");
    expect(row(NOTES).textContent).toContain("Starting the clone");
    expect(row(SHOP)).toHaveProperty("disabled", true);
  });

  it("shows a failed clone's problem in its row, still picked and with no Try again of its own", () => {
    const { render } = picker();
    act(() => row(NOTES).click());

    render({
      ...IDLE,
      url: NOTES.repositoryUrl,
      clone: {
        id: "clone-1",
        url: NOTES.repositoryUrl,
        path: "/data/repositories/github.com/office-user/notes",
        startedAt: "2026-11-17T10:00:00.000Z",
        state: "failed",
        problem: "Repository not found.",
      },
    });

    expect(row(NOTES).textContent).toContain("The clone failed: Repository not found.");
    expect(row(NOTES).getAttribute("aria-pressed")).toBe("true");
    expect(row(NOTES).classList).toContain("failed");
    expect(document.body.textContent).not.toContain("Try again");
  });
});
