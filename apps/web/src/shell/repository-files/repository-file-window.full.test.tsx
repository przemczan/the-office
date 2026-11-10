import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BaseBranchFetch, BaseBranchFolder } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryFile } from "./repository-file-browser.tsx";
import { RepositoryFileWindow } from "./repository-file-window.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMMIT = "a".repeat(40);
const FETCHED: BaseBranchFetch = { commit: COMMIT, fetchProblem: null };

function folder(path: string, fields: Partial<BaseBranchFolder> = {}): BaseBranchFolder {
  const entries = fields.entries ?? [];
  return { commit: COMMIT, path, entries, total: entries.length, ...fields };
}

const TOP = folder("", {
  entries: [
    { name: "assets", kind: "folder" },
    { name: "README.md", kind: "file" },
  ],
});
const ASSETS = folder("assets", {
  entries: [
    { name: "icons", kind: "folder" },
    { name: "logo.png", kind: "file" },
  ],
});
const ICONS = folder("assets/icons", { entries: [{ name: "a.png", kind: "file" }] });

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const refusal = (reason: string): Answer => ({
  status: 422,
  body: { statusCode: 422, message: reason, reasons: [reason] },
});

let page: HTMLDivElement;
let root: Root;
let requests: string[];
let fetchAnswer: Answer;
let folders: Record<string, Answer>;
let picked: RepositoryFile[];
let closed: number;
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  requests = [];
  picked = [];
  closed = 0;
  fetchAnswer = { status: 200, body: FETCHED };
  folders = {
    "": { status: 200, body: TOP },
    assets: { status: 200, body: ASSETS },
    "assets/icons": { status: 200, body: ICONS },
  };
  vi.stubGlobal("fetch", (input: string) => {
    requests.push(input);
    const url = new URL(input, "http://office.test");
    const answer = url.pathname.endsWith("/fetch")
      ? fetchAnswer
      : (folders[url.searchParams.get("path") ?? ""] ?? refusal("No such folder."));
    return Promise.resolve(Response.json(answer.body, { status: answer.status }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  page.remove();
  vi.unstubAllGlobals();
});

/** Until nothing is being asked of the service, and what it answered is on the page. */
async function settled(): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
  });
}

async function open(extensions: readonly string[] = ["png"]): Promise<void> {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RepositoryFileWindow
          projectId="shop"
          title="Choose a file"
          extensions={extensions}
          onPick={(file) => picked.push(file)}
          onClose={() => (closed += 1)}
        />
      </QueryClientProvider>,
    ),
  );
  await settled();
}

function button(name: string): HTMLButtonElement {
  // A design system Button holds its spinner's style after its words.
  const found = [...document.querySelectorAll("button")].find(({ textContent }) =>
    textContent.startsWith(name),
  );
  if (!found) throw new Error(`No button ${name}: ${document.body.textContent}`);
  return found;
}

async function press(element: HTMLElement): Promise<void> {
  act(() => element.click());
  await settled();
}

function breadcrumb(name: string): HTMLElement {
  const found = [...document.querySelectorAll("a")].find(({ textContent }) => textContent === name);
  if (!found) throw new Error(`No breadcrumb ${name}: ${document.body.textContent}`);
  return found;
}

function folderRequests(): URL[] {
  return requests
    .filter((request) => !request.endsWith("/fetch"))
    .map((request) => new URL(request, "http://office.test"));
}

describe("RepositoryFileWindow", () => {
  it("fetches the base branch once and reads only the folder opened, all from that commit", async () => {
    await open();
    await press(button("assets"));
    await press(button("icons"));

    expect(requests.filter((request) => request.endsWith("/base-branch/fetch"))).toHaveLength(1);
    expect(folderRequests().map(({ searchParams }) => searchParams.get("path"))).toEqual([
      "",
      "assets",
      "assets/icons",
    ]);
    for (const { pathname } of folderRequests()) expect(pathname).toContain(`/${COMMIT}/folder`);
  });

  it("asks for the caller's extensions", async () => {
    await open(["png", "svg"]);

    expect(folderRequests()[0]?.searchParams.get("extensions")).toBe("png,svg");
  });

  it("goes back up through the breadcrumbs, without asking for a folder again", async () => {
    await open();
    await press(button("assets"));
    await press(button("icons"));
    await press(breadcrumb("Top level"));

    expect(button("README.md")).toBeDefined();
    expect(folderRequests()).toHaveLength(3);
  });

  it("opens a folder already read at its top, not where the last one was scrolled", async () => {
    await open();
    await press(button("assets"));
    const assets = document.querySelector(".repository-file-list");
    await press(breadcrumb("Top level"));

    expect(document.querySelector(".repository-file-list")).not.toBe(assets);
  });

  it("fetches the base branch anew at the next sitting", async () => {
    await open();
    act(() => root.unmount());
    await act(async () => {
      await vi.waitFor(() => expect(queryClient.getQueryCache().findAll()).toHaveLength(1));
    });
    root = createRoot(page);
    await open();

    expect(requests.filter((request) => request.endsWith("/base-branch/fetch"))).toHaveLength(2);
  });

  it("has Close in its bar", async () => {
    await open();
    await press(button("Close"));

    expect(closed).toBe(1);
  });

  it("gives a picked file's path and commit, once one is selected", async () => {
    await open();
    await press(button("assets"));
    const choose = button("Choose file");

    expect(choose.disabled).toBe(true);
    expect(choose.title).toBe("Select a file in the list first.");

    await press(button("logo.png"));
    expect(button("logo.png").getAttribute("aria-pressed")).toBe("true");
    await press(button("Choose file"));

    expect(picked).toEqual([{ path: "assets/logo.png", commit: COMMIT }]);
  });

  it("drops what was selected on opening another folder", async () => {
    await open();
    await press(button("README.md"));
    await press(button("assets"));

    expect(button("Choose file").disabled).toBe(true);
  });

  it("says when the fetch failed and still lists the last commit known", async () => {
    fetchAnswer = { status: 200, body: { commit: COMMIT, fetchProblem: "Could not read remote." } };
    await open();

    expect(document.body.textContent).toContain(
      "Showing the last commit known on this workstation",
    );
    expect(document.body.textContent).toContain("Could not read remote.");
    expect(button("README.md")).toBeDefined();
  });

  it("says how many entries a crowded folder left out", async () => {
    folders[""] = { status: 200, body: { ...TOP, total: 1_250 } };
    await open();

    expect(document.body.textContent).toContain(
      "Showing the first 2 of 1,250 entries: 1,248 left out.",
    );
  });

  it("says what would fill an empty folder", async () => {
    folders[""] = { status: 200, body: folder("") };
    await open(["png", ".svg"]);

    expect(document.body.textContent).toContain("No .png or .svg files in this folder");
    expect(document.body.textContent).toContain(
      "A file shows here once it is committed on the base branch.",
    );
  });

  it("shows a refused folder, and the way back out of it", async () => {
    folders["assets"] = refusal("The repository holds no commit.");
    await open();
    await press(button("assets"));

    expect(document.body.textContent).toContain("This folder can't be read");
    expect(document.body.textContent).toContain("The repository holds no commit.");

    await press(breadcrumb("Top level"));
    expect(button("README.md")).toBeDefined();
  });

  it("shows why the base branch can't be read", async () => {
    fetchAnswer = refusal("Shop's base branch main can't be read: gone.");
    await open();

    expect(document.body.textContent).toContain("The base branch can't be read");
    expect(document.body.textContent).toContain("Shop's base branch main can't be read: gone.");
    expect(folderRequests()).toEqual([]);
  });
});
