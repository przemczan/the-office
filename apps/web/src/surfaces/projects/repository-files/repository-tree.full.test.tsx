import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RepositoryFolder } from "@the-office/contracts";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryTree, type RepositoryEntryKind } from "./repository-tree.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMMIT = "b".repeat(40);

function folder(path: string, fields: Partial<RepositoryFolder> = {}): RepositoryFolder {
  const entries = fields.entries ?? [];
  return { commit: COMMIT, path, entries, total: entries.length, ...fields };
}

const TOP = folder("", {
  entries: [
    { name: "src", kind: "folder" },
    { name: "README.md", kind: "file" },
  ],
});
const SRC = folder("src", {
  entries: [
    { name: "lib", kind: "folder" },
    { name: "app.ts", kind: "file" },
  ],
});
const LIB = folder("src/lib", { entries: [{ name: "util.ts", kind: "file" }] });

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

let page: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let folders: Record<string, Answer>;
let requests: URL[];
let picked: [string, RepositoryEntryKind][];

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  requests = [];
  picked = [];
  folders = {
    "": { status: 200, body: TOP },
    src: { status: 200, body: SRC },
    "src/lib": { status: 200, body: LIB },
  };
  vi.stubGlobal("fetch", (input: string) => {
    const url = new URL(input, "http://office.test");
    requests.push(url);
    const reason = "No such folder.";
    const answer = folders[url.searchParams.get("path") ?? ""] ?? {
      status: 422,
      body: { statusCode: 422, message: reason, reasons: [reason] },
    };
    return Promise.resolve(Response.json(answer.body, { status: answer.status }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  page.remove();
  vi.unstubAllGlobals();
});

function Tree({ reveal }: { readonly reveal: string }): ReactNode {
  const [selected, setSelected] = useState(reveal);
  return (
    <RepositoryTree
      projectId="shop"
      commit={COMMIT}
      label="Files on main"
      selected={selected}
      reveal={selected}
      onSelect={(path, kind) => {
        picked.push([path, kind]);
        setSelected(path);
      }}
    />
  );
}

async function settled(): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
  });
}

async function open(reveal = ""): Promise<void> {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Tree reveal={reveal} />
      </QueryClientProvider>,
    ),
  );
  await settled();
}

function item(path: string): HTMLElement {
  const found = page.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);
  if (!found) throw new Error(`No item ${path}: ${page.textContent}`);
  return found;
}

function shownPaths(): string[] {
  return [...page.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
    (element) => element.dataset["path"] ?? "",
  );
}

async function press(path: string): Promise<void> {
  const row = item(path).querySelector<HTMLElement>(".repository-tree-row");
  act(() => row?.click());
  await settled();
}

async function key(name: string): Promise<void> {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) throw new Error("Nothing is focused.");
  act(() => {
    focused.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
  await settled();
}

function readPaths(): (string | null)[] {
  return requests.map(({ searchParams }) => searchParams.get("path"));
}

describe("RepositoryTree", () => {
  it("is a tree of the commit's top level, folders folded", async () => {
    await open();

    expect(page.querySelector('[role="tree"]')?.getAttribute("aria-label")).toBe("Files on main");
    expect(shownPaths()).toEqual(["src", "README.md"]);
    expect(item("src").getAttribute("aria-expanded")).toBe("false");
    expect(item("README.md").hasAttribute("aria-expanded")).toBe(false);
    expect(item("src").getAttribute("aria-level")).toBe("1");
    for (const { pathname } of requests) expect(pathname).toContain(`/commits/${COMMIT}/folder`);
  });

  it("reads a folder only once it is unfolded, and once", async () => {
    await open();
    expect(readPaths()).toEqual([""]);

    await press("src");
    expect(readPaths()).toEqual(["", "src"]);
    expect(item("src").getAttribute("aria-expanded")).toBe("true");
    expect(item("src/app.ts").getAttribute("aria-level")).toBe("2");
    expect(item("src").querySelector('[role="group"]')).not.toBeNull();

    await press("src");
    expect(item("src").getAttribute("aria-expanded")).toBe("false");
    expect(shownPaths()).toEqual(["src", "README.md"]);

    await press("src");
    expect(readPaths()).toEqual(["", "src"]);
  });

  it("selects what is pressed", async () => {
    await open();
    await press("README.md");

    expect(picked).toEqual([["README.md", "file"]]);
    expect(item("README.md").getAttribute("aria-selected")).toBe("true");
    expect(item("src").getAttribute("aria-selected")).toBe("false");
  });

  it("moves through the tree by the keyboard, one item reached by Tab", async () => {
    await open();
    const tabbable = (): string[] =>
      shownPaths().filter((path) => item(path).getAttribute("tabindex") === "0");
    expect(tabbable()).toEqual(["src"]);
    act(() => item("src").focus());

    await key("ArrowRight");
    expect(item("src").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(item("src"));

    await key("ArrowRight");
    expect(document.activeElement).toBe(item("src/lib"));
    await key("ArrowDown");
    expect(document.activeElement).toBe(item("src/app.ts"));
    expect(tabbable()).toEqual(["src/app.ts"]);

    await key("ArrowLeft");
    expect(document.activeElement).toBe(item("src"));
    await key("ArrowLeft");
    expect(item("src").getAttribute("aria-expanded")).toBe("false");

    await key("End");
    expect(document.activeElement).toBe(item("README.md"));
    await key("Home");
    expect(document.activeElement).toBe(item("src"));
    await key("ArrowDown");
    await key("ArrowUp");
    expect(document.activeElement).toBe(item("src"));

    await key("End");
    await key("Enter");
    expect(picked).toEqual([["README.md", "file"]]);

    await key("Home");
    await key(" ");
    expect(item("src").getAttribute("aria-expanded")).toBe("true");
    expect(picked.at(-1)).toEqual(["src", "folder"]);
  });

  it("unfolds the folders down to the path it reveals", async () => {
    await open("src/lib/util.ts");

    expect(readPaths()).toEqual(["", "src", "src/lib"]);
    expect(item("src/lib/util.ts").getAttribute("aria-selected")).toBe("true");
    expect(item("src/lib/util.ts").getAttribute("tabindex")).toBe("0");
  });

  it("says how many entries a crowded folder left out", async () => {
    folders["src"] = { status: 200, body: { ...SRC, total: 1_250 } };
    await open();
    await press("src");

    expect(page.textContent).toContain("Showing the first 2 of 1,250 entries: 1,248 left out.");
  });

  it("shows why a folder can't be read, under it", async () => {
    folders["src"] = {
      status: 422,
      body: { statusCode: 422, message: "Gone.", reasons: ["Gone."] },
    };
    await open();
    await press("src");

    expect(item("src").textContent).toContain("This folder can't be read");
    expect(item("src").textContent).toContain("Gone.");
  });
});
