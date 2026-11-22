import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import type {
  Project,
  ProjectBranches,
  RepositoryFilePreview,
  RepositoryFolder,
} from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { ToastProvider } from "../../shell/toasts.tsx";
import { ProjectFilesSection } from "./files-section.tsx";
import { projectFilesSearchOf } from "./files-search.ts";
import { ProjectPage } from "./project-page.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so the branch picker's list never resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const MAIN = "a".repeat(40);
const FEATURE = "c".repeat(40);

const PROJECT: Project = {
  id: "shop",
  name: "Shop",
  path: "/projects/shop",
  baseBranch: "main",
  mark: { label: "SH", colour: "teal" },
  installCommand: "",
  commands: [],
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

const BRANCHES: ProjectBranches = {
  baseBranch: { name: "main", kind: "local", commit: MAIN },
  branches: [
    { name: "feature", kind: "local", commit: FEATURE },
    { name: "origin/main", kind: "remote", commit: MAIN },
  ],
  fetchProblem: null,
};

function folder(commit: string, path: string, names: readonly string[]): RepositoryFolder {
  const entries = names.map((name) =>
    name.endsWith("/")
      ? { name: name.slice(0, -1), kind: "folder" as const }
      : { name, kind: "file" as const },
  );
  return { commit, path, entries, total: entries.length };
}

const FOLDERS: Readonly<Record<string, Readonly<Record<string, RepositoryFolder>>>> = {
  [MAIN]: {
    "": folder(MAIN, "", ["docs/", "src/", "README.md", "logo.png", "app.bin", "big.log"]),
    src: folder(MAIN, "src", ["app.ts"]),
    docs: folder(MAIN, "docs", ["guides/"]),
    "docs/guides": folder(MAIN, "docs/guides", ["start.md"]),
  },
  [FEATURE]: { "": folder(FEATURE, "", ["feature.txt"]) },
};

const PREVIEWS: Readonly<Record<string, RepositoryFilePreview>> = {
  "src/app.ts": { kind: "text", size: 30, text: "const a = 1;\nconst b = 2;\n" },
  "README.md": { kind: "text", size: 20, text: "# Shop\n\nSells *things*." },
  "logo.png": { kind: "image", size: 2048 },
  "app.bin": { kind: "binary", size: 512 },
  "big.log": { kind: "too-large", size: 3 * 1024 * 1024 },
};

let root: Root | undefined;
let router: AnyRouter;
let requests: URL[];
let branches: ProjectBranches;
let copied: string[];

function answer(url: URL): Response {
  const path = url.searchParams.get("path") ?? "";
  if (url.pathname === "/api/projects/shop") return Response.json(PROJECT);
  if (url.pathname === "/api/projects/shop/branches") return Response.json(branches);
  const commit = /\/commits\/(\w+)\//.exec(url.pathname)?.[1] ?? "";
  if (url.pathname.endsWith("/folder")) {
    const found = FOLDERS[commit]?.[path];
    if (found) return Response.json(found);
  }
  if (url.pathname.endsWith("/file-preview")) {
    const found = PREVIEWS[path];
    if (found) return Response.json(found);
  }
  return Response.json({ message: "Not here.", reasons: ["Not here."] }, { status: 422 });
}

beforeEach(() => {
  requests = [];
  copied = [];
  branches = BRANCHES;
  vi.stubGlobal("fetch", (input: string) => {
    const url = new URL(input, "http://office.test");
    requests.push(url);
    return Promise.resolve(answer(url));
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  document.body.replaceChildren();
});

async function open(address: string): Promise<HTMLElement> {
  const rootRoute = createRootRoute({ component: Outlet });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "projects/$projectId",
    component: ProjectPage,
  });
  const filesRoute = createRoute({
    getParentRoute: () => projectRoute,
    path: "files",
    component: ProjectFilesSection,
    validateSearch: projectFilesSearchOf,
  });
  router = createRouter({
    routeTree: rootRoute.addChildren([projectRoute.addChildren([filesRoute])]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    root = createRoot(page);
    root.render(
      <QueryClientProvider client={queryClient}>
        <PageHeadingProvider setPageHeading={() => undefined}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </PageHeadingProvider>
      </QueryClientProvider>,
    );
  });
  await settled();
  return page;
}

async function settled(): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(document.body.textContent).not.toMatch(/Fetching branches…|Reading the/);
  });
}

function tree(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="tree"]');
  if (!found) throw new Error(`No tree: ${document.body.textContent}`);
  return found;
}

function item(path: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);
  if (!found) throw new Error(`No item ${path}: ${document.body.textContent}`);
  return found;
}

function preview(): HTMLElement {
  const found = document.querySelector<HTMLElement>('section[aria-label="Preview"]');
  if (!found) throw new Error(`No preview: ${document.body.textContent}`);
  return found;
}

function branchPicker(): HTMLButtonElement {
  const label = [...document.querySelectorAll("label")].find(
    ({ textContent }) => textContent.trim() === "Branch",
  );
  const picker = label && document.getElementById(label.htmlFor);
  if (!(picker instanceof HTMLButtonElement)) throw new Error("No Branch picker.");
  return picker;
}

function button(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(({ textContent }) =>
    textContent.startsWith(name),
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  act(() => element.click());
  await settled();
}

async function select(path: string): Promise<void> {
  const row = item(path).querySelector<HTMLElement>(".repository-tree-row");
  if (row) await click(row);
}

function search(): Record<string, unknown> {
  return router.state.location.search;
}

describe("ProjectFilesSection", () => {
  it("shows the base branch first, fetched as it opens, with nothing selected", async () => {
    await open("/projects/shop/files");

    expect(
      requests.some(
        ({ pathname, search: query }) => pathname.endsWith("/branches") && query === "?fetch=1",
      ),
    ).toBe(true);
    expect(branchPicker().textContent).toContain("main");
    expect(branchPicker().getAttribute("role")).toBe("combobox");
    expect(tree().getAttribute("aria-label")).toBe("Files on main");
    expect(item("README.md")).toBeDefined();
    expect(preview().textContent).toContain("No file selected");
  });

  it("lists the base branch, then the local and the remote branches", async () => {
    await open("/projects/shop/files");
    await click(branchPicker());

    const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')].map((group) =>
      [...group.querySelectorAll('[role="option"]')].map(({ id, textContent }) => [
        document.getElementById(`${id}-label`)?.textContent,
        textContent.includes("base branch"),
      ]),
    );
    expect(groups).toEqual([[["main", true]], [["feature", false]], [["origin/main", false]]]);
  });

  it("switches branch, leaving nothing selected", async () => {
    await open("/projects/shop/files?path=README.md");
    await click(branchPicker());
    const feature = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      ({ textContent }) => textContent.startsWith("feature"),
    );
    if (!feature) throw new Error("No feature option.");
    await click(feature);

    expect(search()).toEqual({ branch: "feature" });
    expect(tree().getAttribute("aria-label")).toBe("Files on feature");
    expect(item("feature.txt")).toBeDefined();
    expect(requests.some(({ pathname }) => pathname.includes(`/commits/${FEATURE}/folder`))).toBe(
      true,
    );
  });

  it("says when the branches couldn't be fetched, and shows the last known", async () => {
    branches = { ...BRANCHES, fetchProblem: "Could not read from remote." };
    await open("/projects/shop/files");

    expect(document.body.textContent).toContain(
      "Showing the last commits known on this workstation",
    );
    expect(document.body.textContent).toContain("Could not read from remote.");
    expect(item("README.md")).toBeDefined();
  });

  it("says when the address names a branch that isn't there", async () => {
    await open("/projects/shop/files?branch=gone");

    expect(document.body.textContent).toContain("Shop has no branch gone");
    expect(document.querySelector('[role="tree"]')).toBeNull();
  });

  it("puts what is selected in the address", async () => {
    await open("/projects/shop/files");
    await select("src");
    expect(search()).toEqual({ path: "src" });

    await select("src/app.ts");
    expect(search()).toEqual({ path: "src/app.ts" });
  });

  it("shows a text file with its line numbers", async () => {
    await open("/projects/shop/files?path=src%2Fapp.ts");

    expect(item("src").getAttribute("aria-expanded")).toBe("true");
    expect(item("src/app.ts").getAttribute("aria-selected")).toBe("true");
    expect(preview().querySelector(".plain-text-file-numbers")?.textContent).toBe("1\n2");
    expect(preview().querySelector(".plain-text-file-lines")?.textContent).toBe(
      "const a = 1;\nconst b = 2;",
    );
  });

  it("renders a Markdown file, its source a switch away", async () => {
    await open("/projects/shop/files?path=README.md");

    const rendered = preview().querySelector(".markdown-document");
    expect(rendered?.querySelector("h1")?.textContent).toBe("Shop");
    expect(rendered?.querySelector("em")?.textContent).toBe("things");

    await click(button(preview(), "Source"));
    expect(preview().querySelector(".plain-text-file-lines")?.textContent).toContain("# Shop");
  });

  it("shows an image from the file route", async () => {
    await open("/projects/shop/files?path=logo.png");

    const image = preview().querySelector("img");
    const source = new URL(image?.getAttribute("src") ?? "", "http://office.test");
    expect(source.pathname).toBe(`/api/projects/shop/commits/${MAIN}/file`);
    expect(source.searchParams.get("path")).toBe("logo.png");
    expect(source.searchParams.has("download")).toBe(false);
    expect(image?.getAttribute("alt")).toBe("logo.png");
  });

  it.each([
    ["app.bin", "It holds binary data (512 bytes)."],
    ["big.log", "It is 3 MB, over the 1 MB a preview shows."],
  ])("offers %s to download, as it can't be previewed", async (path, why) => {
    await open(`/projects/shop/files?path=${path}`);

    expect(preview().textContent).toContain("This file can't be previewed");
    expect(preview().textContent).toContain(why);
    const downloads = [...preview().querySelectorAll("a[download]")].map(
      (link) => new URL(link.getAttribute("href") ?? "", "http://office.test"),
    );
    expect(downloads).toHaveLength(2);
    for (const download of downloads) {
      expect(download.searchParams.get("path")).toBe(path);
      expect(download.searchParams.get("download")).toBe("1");
    }
  });

  it("copies the file's path and a link that reopens it", async () => {
    await open("/projects/shop/files?branch=feature");
    await select("feature.txt");
    await click(button(preview(), "Copy path"));
    await click(button(preview(), "Copy link"));

    expect(copied[0]).toBe("feature.txt");
    const link = new URL(copied[1] ?? "");
    expect(link.origin).toBe(window.location.origin);
    expect(link.pathname).toBe("/projects/shop/files");
    expect(projectFilesSearchOf(Object.fromEntries(link.searchParams))).toEqual({
      branch: "feature",
      path: "feature.txt",
    });
  });

  it("unfolds the tree down to a folder the address names, previewing nothing", async () => {
    await open("/projects/shop/files?path=docs%2Fguides");

    expect(item("docs").getAttribute("aria-expanded")).toBe("true");
    expect(item("docs/guides").getAttribute("aria-expanded")).toBe("true");
    expect(item("docs/guides").getAttribute("aria-selected")).toBe("true");
    expect(item("docs/guides/start.md")).toBeDefined();
    expect(preview().textContent).toContain("docs/guides is a folder");
    expect(requests.some(({ pathname }) => pathname.endsWith("/file-preview"))).toBe(false);
  });
});
