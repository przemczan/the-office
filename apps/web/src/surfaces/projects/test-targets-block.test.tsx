import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  EditedTestTarget,
  Project,
  ProjectTestTargetsChat,
  Role,
  TaskState,
  TestTarget,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shell/toasts.tsx";
import { TestTargetsBlock } from "./test-targets-block.tsx";

const held = vi.hoisted(() => ({
  devops: undefined as
    { key: string; card: { name: string; capabilities: { chat: boolean } } } | undefined,
  opened: [] as { thread: { id: string; roleKey: string }; draft: string }[],
}));

vi.mock("../../shell/ask-devops.tsx", () => ({ useDevops: () => held.devops }));
vi.mock("../../shell/use-duty-holder.ts", () => ({
  useDutyHolder: () => ({
    holder: held.devops,
    label: "Onboards and repairs Projects",
    fallback: held.devops ? undefined : "unstaffed",
  }),
}));
vi.mock("../../shell/use-hired.ts", () => ({
  useHired: (roleKey: string | undefined) =>
    roleKey === held.devops?.key ? (held.devops as unknown as Role) : undefined,
}));
vi.mock("../../shell/chat/ask-in-chat.tsx", () => ({
  useOpenWithDraft:
    () =>
    (thread: { id: string; roleKey: string }, draft: string): Promise<void> => {
      held.opened.push({ thread, draft });
      return Promise.resolve();
    },
}));
vi.mock("../../shell/chat/use-chat.tsx", () => ({ useChat: () => ({ open: () => undefined }) }));
vi.mock("../../shell/use-user-name.ts", () => ({ useSignedInUserId: () => "u1" }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params: { taskId: string };
  }) => <a href={to.replace("$taskId", params.taskId)}>{children}</a>,
}));

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
  installCommand: "npm ci",
  commands: [],
  installInputs: ["package-lock.json"],
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

afterEach(() => {
  held.devops = undefined;
  held.opened.length = 0;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const TASK: { id: string; title: string; state: TaskState } = {
  id: "t1",
  title: "Set up test targets for Admin panel",
  state: "ready",
};

const DWIGHT = { key: "devops", card: { name: "Dwight", capabilities: { chat: true } } };

const THREAD_ID = "8a6a2a43-4f7b-4a39-9f0c-1f8a3b2c1d01";

/** Answers each request by its method and path; a POST to the chat answers `asked`. */
function serving(followed: ProjectTestTargetsChat, asked: ProjectTestTargetsChat = followed) {
  const fetched = vi.fn<(url: string, request?: RequestInit) => Promise<Response>>(
    (url, request) => {
      if (url.endsWith("/test-targets")) return Promise.resolve(Response.json({ targets: [] }));
      if (url.endsWith("/test-targets/chat") && request?.method === "POST") {
        return Promise.resolve(Response.json(asked));
      }
      if (url.endsWith("/test-targets/chat")) return Promise.resolve(Response.json(followed));
      return Promise.resolve(Response.json([]));
    },
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

function chatOf(state: "draft" | "answering" | "waiting-on-you" | "proposal") {
  return {
    chat: { threadId: THREAD_ID, roleKey: "devops", state, since: "2026-11-22T10:00:00.000Z" },
    setUpTask: null,
  };
}

const NOTHING_ASKED: ProjectTestTargetsChat = { chat: null, setUpTask: null };

function buttonWith(page: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((each) => each.textContent.includes(words));
}

describe("the Project page's Test targets block, asking in a chat", () => {
  it("starts the chat with Dwight and opens it with the draft waiting", async () => {
    held.devops = DWIGHT;
    const fetched = serving(NOTHING_ASKED, chatOf("draft"));
    const { page, queryClient } = await shown();

    const button = buttonWith(page, "Ask Dwight to set up test targets");
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
      await new Promise((resolve) => setTimeout(resolve));
    });

    const post = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(post?.[0]).toBe("/api/projects/admin-panel/test-targets/chat");
    expect(held.opened).toEqual([
      {
        thread: { id: THREAD_ID, roleKey: "devops" },
        draft:
          "Can you set up the test targets of Admin panel? Read its repository, change no file, and propose them.",
      },
    ]);
    expect(page.textContent).toContain("Draft waiting");
    expect(page.textContent).toContain("Asked Dwight in a chat");
    expect(page.textContent).toContain("Your draft waits in the chat for you to send it.");
    expect(buttonWith(page, "Ask Dwight to set up test targets")).toBeUndefined();
    expect(buttonWith(page, "Ask again")).toBeDefined();
  });

  it("follows the chat while Dwight answers, with Ask again as no Proposal is open", async () => {
    held.devops = DWIGHT;
    serving(chatOf("answering"));
    const { page } = await shown();

    await vi.waitFor(() => expect(page.textContent).toContain("Dwight is reading the repository"));
    expect(page.textContent).toContain("In a chat, on the base branch main");
    expect(buttonWith(page, "Open the chat")).toBeDefined();
    expect(buttonWith(page, "Ask again")).toBeDefined();
  });

  it("says Dwight replied, with Ask again", async () => {
    held.devops = DWIGHT;
    serving(chatOf("waiting-on-you"));
    const { page } = await shown();

    await vi.waitFor(() => expect(page.textContent).toContain("Dwight replied in the chat"));
    expect(page.textContent).toContain("Waiting on you");
    expect(buttonWith(page, "Ask again")).toBeDefined();
  });

  it("offers no Ask again while the chat's Proposal is open", async () => {
    held.devops = DWIGHT;
    serving(chatOf("proposal"));
    const { page } = await shown();

    await vi.waitFor(() => expect(page.textContent).toContain("Proposal ready"));
    expect(buttonWith(page, "Ask again")).toBeUndefined();
    expect(buttonWith(page, "Ask Dwight")).toBeUndefined();
  });

  it("says nobody onboards Projects while nobody holds the duty", async () => {
    serving(NOTHING_ASKED);
    const { page } = await shown();

    expect(page.textContent).toContain(
      "Nobody onboards Projects yet: give Onboards and repairs Projects to someone in People.",
    );
    expect(buttonWith(page, "set up test targets")).toBeUndefined();
  });

  it("shows an open set-up Task made before in place of the button", async () => {
    held.devops = DWIGHT;
    serving({ chat: null, setUpTask: { ...TASK, state: "in-progress" } });
    const { page } = await shown();

    await vi.waitFor(() => expect(page.textContent).toContain("Being set up"));
    expect(buttonWith(page, "Ask Dwight")).toBeUndefined();
    expect(page.textContent).toContain(`Being set up in the Task ${TASK.title} · In progress.`);
    expect(page.textContent).toContain("Made before test targets were set up in a chat.");
    expect(page.querySelector("a")?.getAttribute("href")).toBe("/tasks/t1");
  });
});

const COMMANDS: Project["commands"] = [
  { key: "seed", name: "Seed", kind: "build", commandLine: "npm run seed", rerunCommandLine: "" },
  { key: "tools", name: "Tools", kind: "build", commandLine: "npm ci", rerunCommandLine: "" },
];

const WEB: TestTarget = {
  key: "web",
  name: "Web app",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "start", arguments: [] },
  port: 3000,
  variables: [],
  secretVariables: [],
  commandsBefore: ["gone", "seed"],
  portVariable: "PORT",
  memoryMegabytes: null,
  setBy: {
    commandsBefore: {
      by: "proposal",
      proposalId: "p1",
      agent: { roleKey: "devops", name: "Nina" },
    },
  },
};

/** Answers the target list, the Office limits and a save, which answers what it was sent. */
function servingTargets(targets: readonly TestTarget[]) {
  const fetched = vi.fn<(url: string, request?: RequestInit) => Promise<Response>>(
    (url, request) => {
      if (url.endsWith("/test-targets") && request?.method === "PUT") {
        const sent = JSON.parse(String(request.body)) as { targets: object[] };
        return Promise.resolve(
          Response.json({ targets: sent.targets.map((target) => ({ ...target, setBy: {} })) }),
        );
      }
      if (url.endsWith("/test-targets")) return Promise.resolve(Response.json({ targets }));
      if (url.endsWith("/test-targets/chat")) {
        return Promise.resolve(Response.json({ chat: null, setUpTask: null }));
      }
      if (url.endsWith("/settings/run-environments")) {
        return Promise.resolve(
          Response.json({
            runEnvironmentsAtOnce: 2,
            cpuLimit: "automatic",
            fixedCpus: 2,
            memoryMegabytes: 4096,
            processes: 1024,
            hostCores: 8,
            automatic: { checksCpus: 4, otherServicesCpus: 2 },
          }),
        );
      }
      return Promise.resolve(Response.json([]));
    },
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

function buttonNamed(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name || each.textContent.includes(name),
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
}

function group(within: HTMLElement, name: string): HTMLElement {
  const found = within.querySelector<HTMLElement>(`[role=group][aria-label="${name}"]`);
  if (!found) throw new Error(`No group ${name}`);
  return found;
}

function control(within: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement {
  const found = [...within.querySelectorAll("label")].find(
    (each) => each.textContent.trim() === label,
  );
  const input = found && within.ownerDocument.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) {
    throw new Error(`No field ${label}`);
  }
  return input;
}

function fill(field: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype =
    field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

function press(target: HTMLButtonElement): void {
  act(() => target.click());
}

async function shown(
  project: Project = PROJECT,
): Promise<{ page: HTMLElement; queryClient: QueryClient }> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const page = document.createElement("div");
  document.body.append(page);
  await act(async () => {
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TestTargetsBlock project={project} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve));
  });
  await vi.waitFor(() => expect(page.textContent).toContain("Add a test target"));
  return { page, queryClient };
}

describe("the Project page's Test targets block, commands before, port variable and memory", () => {
  it("sums them up in the row and flags a command the Project no longer has", async () => {
    servingTargets([{ ...WEB, memoryMegabytes: 2048 }]);
    const { page } = await shown({ ...PROJECT, commands: COMMANDS });

    const row = group(page, "Web app");
    expect(row.textContent).toContain(
      "Commands before: gone → seed · PORT=3000 · Memory per service 2 GB",
    );
    expect(row.textContent).toContain("gone isn't one of the Project's commands anymore.");
  });

  it("edits them, the memory from the Office default, and saves them with the target", async () => {
    const fetched = servingTargets([WEB]);
    const { page, queryClient } = await shown({ ...PROJECT, commands: COMMANDS });

    await act(async () => {
      buttonNamed(page, "Change Web app").click();
      await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    });
    const commands = group(page, "Commands before the entry point");
    expect(commands.parentElement?.textContent).toContain("Set by Nina");
    expect(commands.textContent).toContain("gone isn't one of the Project's commands anymore.");
    const memory = group(page, "Memory per service");
    await vi.waitFor(() => expect(memory.textContent).toContain("Office default (4 GB)"));
    expect(page.textContent).toContain("OFFICE_TEST_INSTANCE=true and PORT to the port.");

    press(buttonNamed(commands, "Remove gone"));
    fill(control(commands, "Add a command"), "tools");
    press(buttonNamed(commands, "Move tools up"));
    fill(control(page, "Port variable"), "APP_PORT");
    press(buttonNamed(memory, "Set its own limit"));
    press(buttonNamed(memory, "Raise the memory per service"));
    expect(memory.textContent).toContain("4.5 GB");

    await act(async () => {
      buttonNamed(page, "Save").click();
      await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    });
    const put = fetched.mock.calls.find(([, request]) => request?.method === "PUT");
    const sent = JSON.parse(String(put?.[1]?.body)) as { targets: EditedTestTarget[] };
    expect(sent.targets[0]).toMatchObject({
      commandsBefore: ["tools", "seed"],
      portVariable: "APP_PORT",
      memoryMegabytes: 4608,
    });
  });

  it("says a workstation build ignores a Build to install target's memory", async () => {
    servingTargets([]);
    const { page } = await shown({ ...PROJECT, runEnvironment: "off" });

    press(buttonNamed(page, "Add a test target"));
    const buildToInstall = [...page.querySelectorAll<HTMLElement>("button, [role=radio]")].find(
      (each) => each.textContent.trim() === "Build to install",
    );
    if (!buildToInstall) throw new Error("No Build to install");
    act(() => buildToInstall.click());

    const memory = group(page, "Memory per service");
    expect(memory.textContent).toContain("it builds on the workstation, which ignores it.");
    expect(page.textContent).not.toContain("Port variable");
    expect(page.textContent).toContain("The Office sets OFFICE_TEST_INSTANCE=true.");
  });
});
