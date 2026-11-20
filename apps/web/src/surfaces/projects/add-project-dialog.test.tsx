import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GitHubRepository, GitHubState, RepositoryClone } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import { AddProjectDialog } from "./add-project-dialog.tsx";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => Promise.resolve(),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SIGNED_IN: GitHubState = {
  status: "signed-in",
  app: { slug: "the-office", owner: "office-user", installUrl: "https://github.com/apps/x" },
  login: "office-user",
  permissions: null,
};

function aRepository(name: string): GitHubRepository {
  return {
    fullName: `office-user/${name}`,
    repositoryUrl: `https://github.com/office-user/${name}.git`,
    private: false,
    defaultBranch: "main",
    pushedAt: "2026-11-05T10:00:00Z",
    description: "",
  };
}

const NOTES = aRepository("notes");
const SHOP = aRepository("shop");

function failedClone(id: string, url: string): RepositoryClone {
  return {
    id,
    url,
    path: "/data/repositories/github.com/office-user/x",
    startedAt: "2026-11-17T10:00:00.000Z",
    finishedAt: "2026-11-17T10:00:01.000Z",
    state: "failed",
    problem: "Repository not found.",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The service: signed in with two repositories, no Projects, and every clone failing. */
function service() {
  const started: string[] = [];
  const clones = new Map<string, RepositoryClone>();
  const fetched = vi.fn<(url: string, request?: RequestInit) => Promise<Response>>(
    (url, request) => {
      if (request?.method === "POST" && url.endsWith("/repositories/clones")) {
        const { url: cloned } = JSON.parse(String(request.body)) as { url: string };
        started.push(cloned);
        const clone = failedClone(`clone-${started.length}`, cloned);
        clones.set(clone.id, clone);
        return Promise.resolve(Response.json(clone, { status: 201 }));
      }
      const clone = /\/repositories\/clones\/([^/]+)$/.exec(url);
      if (clone) return Promise.resolve(Response.json(clones.get(clone[1] ?? "")));
      if (url.endsWith("/github/repositories"))
        return Promise.resolve(Response.json([NOTES, SHOP]));
      if (url.endsWith("/github")) return Promise.resolve(Response.json(SIGNED_IN));
      if (url.endsWith("/projects")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({ message: "Not here" }, { status: 404 }));
    },
  );
  vi.stubGlobal("fetch", fetched);
  return { started };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve));
  });
}

async function openFromGitHub(): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AddProjectDialog onClose={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  const fromGitHub = [...document.body.querySelectorAll<HTMLElement>("button, [role=tab]")].find(
    (found) => found.textContent.trim() === "From GitHub",
  );
  if (!fromGitHub) throw new Error("No From GitHub");
  act(() => fromGitHub.click());
  await settle();
}

function cloneButton(): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find((button) =>
    button.textContent.startsWith("Clone"),
  );
  if (!found) throw new Error("No Clone");
  return found;
}

function row(repository: GitHubRepository): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[aria-label="${repository.fullName}"]`);
  if (!found) throw new Error(`No row for ${repository.fullName}`);
  return found;
}

describe("Add a Project from GitHub", () => {
  it("holds Clone until a repository is picked, and a pick starts no clone", async () => {
    const { started } = service();
    await openFromGitHub();

    expect(cloneButton().disabled).toBe(true);
    act(() => row(NOTES).click());
    await settle();

    expect(started).toEqual([]);
    expect(row(NOTES).getAttribute("aria-pressed")).toBe("true");
    expect(cloneButton().disabled).toBe(false);
  });

  it("clones the repository picked last with Clone", async () => {
    const { started } = service();
    await openFromGitHub();

    act(() => row(NOTES).click());
    act(() => row(SHOP).click());
    act(() => cloneButton().click());
    await settle();

    expect(started).toEqual([SHOP.repositoryUrl]);
    expect(row(SHOP).textContent).toContain("The clone failed: Repository not found.");
  });

  it("tries a failed clone again with Clone", async () => {
    const { started } = service();
    await openFromGitHub();

    act(() => row(NOTES).click());
    act(() => cloneButton().click());
    await settle();
    expect(row(NOTES).textContent).toContain("The clone failed");
    expect(cloneButton().disabled).toBe(false);

    act(() => cloneButton().click());
    await settle();

    expect(started).toEqual([NOTES.repositoryUrl, NOTES.repositoryUrl]);
  });
});
