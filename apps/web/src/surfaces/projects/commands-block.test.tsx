import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, ProjectCommand } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import { CommandsBlock } from "./commands-block.tsx";

// Asking Devops needs the chat; this block's own rows don't.
vi.mock("../../shell/ask-devops.tsx", () => ({ AskDevopsButton: () => null }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMMANDS: readonly ProjectCommand[] = [
  { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
  { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
  { key: "test", name: "Test", kind: "test", commandLine: "" },
];

const PROJECT: Project = {
  id: "admin-panel",
  name: "Admin panel",
  path: "/projects/admin-panel",
  baseBranch: "main",
  mark: { label: "AP", colour: "teal" },
  installCommand: "npm ci",
  commands: [...COMMANDS],
  installInputs: ["package-lock.json"],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
  beforePublishingCommand: "",
  afterPublishingCommand: "",
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The block over a page of its own, attached so its windows open over it. */
function blockOf(project: Project): { page: HTMLElement; queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <CommandsBlock project={project} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  );
  return { page, queryClient };
}

/** Answers every request with `answer`, keeping each request to look at. */
function answering(answer: () => Response) {
  const fetched = vi.fn<(url: string, request?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(answer()),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

function button(within: ParentNode, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name || wordsOf(each) === name,
  );
  if (!found) throw new Error(`There is no ${name} button.`);
  return found;
}

/** A button's words, without the style its loading spinner carries. */
function wordsOf(control: HTMLButtonElement): string {
  return [...control.childNodes]
    .filter((node) => node.nodeName !== "STYLE")
    .map((node) => node.textContent)
    .join("")
    .replace(/@keyframes.*$/s, "")
    .trim();
}

function form(page: HTMLElement, name: string): HTMLFormElement {
  const found = page.querySelector<HTMLFormElement>(`form[aria-label="${name}"]`);
  if (!found) throw new Error(`There is no form "${name}".`);
  return found;
}

/** The field labelled `label` inside `within`. */
function field(within: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement {
  const found = [...within.querySelectorAll("label")].find(
    (each) => each.textContent.trim().startsWith(label) && each.htmlFor !== "",
  );
  const control = found && within.ownerDocument.getElementById(found.htmlFor);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    throw new Error(`There is no field "${label}".`);
  }
  return control;
}

function fill(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype =
    control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setValue?.call(control, value);
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

/** Runs what changes the page and lets the answer reach it. */
async function settled(queryClient: QueryClient, change: () => void): Promise<void> {
  await act(async () => {
    change();
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve));
  });
}

function rowText(page: HTMLElement, name: string): string {
  const row = page.querySelector(`[aria-label="The ${name} command"]`);
  if (!row) throw new Error(`There is no ${name} row.`);
  return row.textContent;
}

function lineRow(page: HTMLElement, label: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
  if (!row) throw new Error(`There is no ${label} row.`);
  return row;
}

describe("the Project page's Commands block", () => {
  it("shows install, the install inputs, then each command with its key and kind", () => {
    const { page } = blockOf(PROJECT);

    expect(page.textContent).toContain("Installnpm ci");
    expect(page.textContent).toContain("Install inputspackage-lock.json");
    expect(rowText(page, "Build")).toBe("Buildnpm run buildbuildBuild");
    expect(rowText(page, "Test")).toBe("TestNot settestTest");
  });

  it("changes a command's name, kind and line, keeping its key", async () => {
    const changed = { key: "lint", name: "Static checks", kind: "test", commandLine: "oxlint" };
    const fetched = answering(() =>
      Response.json({
        ...PROJECT,
        commands: COMMANDS.map((command) => (command.key === "lint" ? changed : command)),
      }),
    );
    const { page, queryClient } = blockOf(PROJECT);

    act(() => button(page, "Change the Lint command").click());
    const editor = form(page, "Change the Lint command");
    expect(editor.textContent).toContain("Key lint");
    fill(field(editor, "Name"), "Static checks");
    fill(field(editor, "Kind"), "test");
    fill(field(editor, "Command line"), "oxlint");
    await settled(queryClient, () => button(editor, "Save").click());

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/admin-panel/commands/lint");
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(
      JSON.stringify({ name: "Static checks", kind: "test", commandLine: "oxlint" }),
    );
    expect(document.body.textContent).toContain(
      "Static checks saved. Tasks run it as saved from their next Stage that runs it.",
    );
  });

  it("adds a command with its key, and shows why one is refused", async () => {
    const refusal = 'The key "install" is kept for The Office\'s own use.';
    let refused = true;
    const fetched = answering(() =>
      refused
        ? Response.json({ statusCode: 422, message: refusal, reasons: [refusal] }, { status: 422 })
        : Response.json(PROJECT),
    );
    const { page, queryClient } = blockOf(PROJECT);

    act(() => button(page, "Add a command").click());
    const adding = form(page, "Add a command");
    fill(field(adding, "Key"), "install");
    fill(field(adding, "Name"), "End to end");
    fill(field(adding, "Command line"), "npm run e2e");
    await settled(queryClient, () => button(adding, "Add").click());

    expect(adding.textContent).toContain("The command wasn't added");
    expect(adding.textContent).toContain(refusal);

    refused = false;
    fill(field(adding, "Key"), "test-e2e");
    await settled(queryClient, () => button(adding, "Add").click());

    const [url, request] = fetched.mock.calls[1] ?? [];
    expect(url).toBe("/api/projects/admin-panel/commands");
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe(
      JSON.stringify({
        key: "test-e2e",
        name: "End to end",
        kind: "test",
        commandLine: "npm run e2e",
      }),
    );
    expect(document.body.textContent).toContain("End to end added.");
  });

  it("holds the publishing mode in its Publish group, and saves a new one at once", async () => {
    const fetched = answering(() =>
      Response.json({ ...PROJECT, publishingMode: "push-and-pull-request" }),
    );
    const { page, queryClient } = blockOf(PROJECT);
    const publish = page.querySelector<HTMLElement>('[role="group"][aria-label="Publish"]');
    if (!publish) throw new Error("There is no Publish group.");

    const mode = field(publish, "Publishing");
    expect(mode.value).toBe("merge");
    expect([...(mode as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      "Push and open a pull request",
      "Merge into main",
    ]);
    await settled(queryClient, () => fill(mode, "push-and-pull-request"));

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/admin-panel/publishing-mode");
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(JSON.stringify({ publishingMode: "push-and-pull-request" }));
    expect(document.body.textContent).toContain(
      "Publishing saved. Tasks in Admin panel push and open a pull request.",
    );
  });

  it("shows None for a publishing line not set, with what each line is for", () => {
    const { page } = blockOf(PROJECT);

    const before = lineRow(page, "Before publishing");
    const after = lineRow(page, "After publishing");
    expect(before.querySelector(".command-empty")?.textContent).toBe("None");
    expect(after.querySelector(".command-empty")?.textContent).toBe("None");
    expect(before.textContent).toContain(
      "before anything leaves; what it changes is committed and published",
    );
    expect(after.textContent).toContain("once the pull request opens or the merge lands");
    expect(after.textContent).toContain("OFFICE_PUBLISHED_BRANCH");
    expect(after.textContent).toContain("OFFICE_PULL_REQUEST_URL");
    expect(after.textContent).toContain("OFFICE_PUBLISHING_MODE");
    expect(page.textContent).toContain("never The Office's credentials");
    expect(page.textContent).toContain("Secret variable");
    expect(page.textContent).toContain("safe to run twice");
    expect(page.textContent).toContain("Script Stage time limit of 30 minutes");
  });

  it.each([
    ["before", "Before publishing", "/api/projects/admin-panel/before-publishing-command"],
    ["after", "After publishing", "/api/projects/admin-panel/after-publishing-command"],
  ] as const)("sets the %s publishing line in place", async (which, label, path) => {
    const fetched = answering(() =>
      Response.json({ ...PROJECT, [`${which}PublishingCommand`]: "./publish.sh" }),
    );
    const { page, queryClient } = blockOf(PROJECT);

    act(() => button(page, `Change the ${which} publishing line`).click());
    const input = page.querySelector<HTMLInputElement>(`input[aria-label="${label} line"]`);
    if (!input) throw new Error(`There is no ${label} input.`);
    fill(input, " ./publish.sh ");
    await settled(queryClient, () => button(page, "Save").click());

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe(path);
    expect(request?.method).toBe("PUT");
    expect(request?.body).toBe(JSON.stringify({ commandLine: "./publish.sh" }));
    expect(document.body.textContent).toContain(`${label} line saved.`);
    expect(queryClient.getQueryData(["projects", "admin-panel"])).toMatchObject({
      [`${which}PublishingCommand`]: "./publish.sh",
    });
  });

  it("clears a publishing line, which install's can't be", async () => {
    const set = { ...PROJECT, afterPublishingCommand: "./notify.sh" };
    const fetched = answering(() => Response.json({ ...set, afterPublishingCommand: "" }));
    const { page, queryClient } = blockOf(set);
    expect(lineRow(page, "After publishing").textContent).toContain("./notify.sh");

    act(() => button(page, "Change the after publishing line").click());
    const input = page.querySelector<HTMLInputElement>('input[aria-label="After publishing line"]');
    if (!input) throw new Error("There is no After publishing input.");
    fill(input, "");
    await settled(queryClient, () => button(page, "Save").click());

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/admin-panel/after-publishing-command");
    expect(request?.body).toBe(JSON.stringify({ commandLine: "" }));
    expect(document.body.textContent).toContain("After publishing line cleared.");
    expect(queryClient.getQueryData(["projects", "admin-panel"])).toMatchObject({
      afterPublishingCommand: "",
    });
  });

  it("removes a command only once confirmed in a window", async () => {
    const fetched = answering(() =>
      Response.json({ ...PROJECT, commands: COMMANDS.filter(({ key }) => key !== "build") }),
    );
    const { page, queryClient } = blockOf(PROJECT);

    act(() => button(page, "Remove the Build command").click());
    const confirming = document.querySelector('[role="dialog"]');
    if (!(confirming instanceof HTMLElement)) throw new Error("No window opened.");
    expect(confirming.textContent).toContain("Remove Build?");
    expect(fetched).not.toHaveBeenCalled();
    await settled(queryClient, () => button(confirming, "Remove").click());

    const [url, request] = fetched.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/admin-panel/commands/build");
    expect(request?.method).toBe("DELETE");
    expect(document.body.textContent).toContain("Build removed.");
  });
});
