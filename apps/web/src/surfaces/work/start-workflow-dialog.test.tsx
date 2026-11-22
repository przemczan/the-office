import type {
  CiRunList,
  GitHubState,
  ManualWorkflow,
  ManualWorkflowList,
  Project,
  RefList,
} from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
  type Answers,
  type Sent,
} from "../../shell/page.fixtures.tsx";
import { PROJECT_FILTER_STORAGE_KEY } from "../../shell/project-filter/project-filter-store.ts";
import { CiRunsPage } from "./ci-runs-page.tsx";

// jsdom has no layout, so the branch or tag list, placed under its box, never resizes.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

function aProject(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/projects/${id}`,
    baseBranch: "main",
    mark: { label: name.slice(0, 2).toUpperCase(), colour: "teal" },
    installCommand: "",
    commands: [],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    icon: { light: null, dark: null },
    logo: { light: null, dark: null },
    repositoryUrl: null,
    beforePublishingCommand: "",
    afterPublishingCommand: "",
    deleteMergedBranches: false,
    environment: { set: [], unset: [], prependPath: [] },
    useProjectSkills: false,
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
}

const PROJECTS = [aProject("admin-panel", "Admin panel"), aProject("billing", "Billing")];

const SIGNED_IN: GitHubState = {
  status: "signed-in",
  app: { slug: "the-office-ada", owner: "ada", installUrl: "https://github.com/apps/x" },
  login: "ada",
  permissions: null,
};

const LISTED = { checkedAt: "2026-11-19T14:00:00.000Z", stale: false, problem: null } as const;

const CI_RUNS: CiRunList = {
  runs: [],
  projects: [
    { projectId: "admin-panel", ...LISTED },
    { projectId: "billing", ...LISTED },
  ],
};

const REFS: RefList = {
  branches: ["main", "release/1.x"],
  tags: ["v1.2.0"],
  baseBranch: "main",
  problem: null,
};

const RELEASE: ManualWorkflow = {
  id: "release.yml",
  name: "Release",
  url: "https://github.com/ada/admin-panel/actions/workflows/release.yml",
  inputs: [
    {
      name: "dry_run",
      description: "Only show what it would publish",
      required: false,
      default: "false",
      kind: "yes-no",
      options: [],
    },
    {
      name: "channel",
      description: "Where the release goes",
      required: true,
      default: null,
      kind: "choice",
      options: ["beta", "stable"],
    },
    {
      name: "notes",
      description: "A line for the release notes",
      required: false,
      default: "Fixes",
      kind: "text",
      options: [],
    },
    {
      name: "shards",
      description: "How many runners share the tests",
      required: false,
      default: "3",
      kind: "number",
      options: [],
    },
    {
      name: "target",
      description: "The environment it deploys to",
      required: false,
      default: "staging",
      kind: "environment",
      options: [],
    },
  ],
};

const DEPLOY: ManualWorkflow = {
  id: "deploy.yml",
  name: "Deploy",
  url: "https://github.com/ada/admin-panel/actions/workflows/deploy.yml",
  inputs: [],
};

const AT_MAIN: ManualWorkflowList = { ref: "main", workflows: [RELEASE, DEPLOY], problem: null };

const START_PATH = "POST /api/projects/admin-panel/workflows/release.yml/start";

let sent: Sent[] = [];

/** Work › CI with the Project filter on `projectIds` (every Project for none), Start a workflow open. */
async function openStartWorkflow(
  answers: Answers = {},
  projectIds: readonly string[] = ["admin-panel"],
): Promise<HTMLElement> {
  if (projectIds.length > 0) {
    localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, JSON.stringify(projectIds));
  }
  sent = stubService({
    "GET /api/ci-runs": () => ({ status: 200, body: CI_RUNS }),
    "GET /api/tasks": () => ({ status: 200, body: [] }),
    "GET /api/projects": () => ({ status: 200, body: PROJECTS }),
    "GET /api/github": () => ({ status: 200, body: SIGNED_IN }),
    "GET /api/projects/admin-panel/refs": () => ({ status: 200, body: REFS }),
    "GET /api/projects/admin-panel/workflows?ref=main": () => ({ status: 200, body: AT_MAIN }),
    [START_PATH]: () => ({
      status: 200,
      body: { projectId: "admin-panel", workflow: "release.yml", ref: "main" },
    }),
    ...answers,
  });
  const { page } = await openPage("/work/ci", { "/work/ci": CiRunsPage });
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  });
  await until(() => expect(buttonNamed(page, "Start a workflow")).toBeDefined());
  act(() => buttonNamed(page, "Start a workflow")?.click());
  await until(() => expect(dialog()).not.toBeNull());
  return dialog();
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error("No dialog is open.");
  return found;
}

/** The label whose text, less a required mark, is `text`. */
function labelOf(text: string): HTMLLabelElement | undefined {
  return [...dialog().querySelectorAll("label")].find(
    (label) => label.textContent.replace("*", "").trim() === text,
  );
}

function fieldNamed(text: string): HTMLInputElement | HTMLSelectElement {
  const label = labelOf(text);
  const control = label && document.getElementById(label.htmlFor);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    throw new Error(`There is no field "${text}".`);
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

/** Types into the branch or tag box and picks the option labelled `label`. */
function chooseRef(label: string): void {
  fill(fieldNamed("Branch or tag"), label.slice(0, 3));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.textContent.trim() === label,
  );
  if (!option) throw new Error(`No option is labelled ${label}.`);
  act(() => option.click());
}

function startButton(): HTMLButtonElement | undefined {
  return buttonNamed(dialog(), "Start");
}

afterEach(() => {
  localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_FILTER_STORAGE_KEY }));
  closePage();
});

describe("Start a workflow", () => {
  it("starts on the base branch of the Project the filter narrows to and lists its workflows", async () => {
    const opened = await openStartWorkflow();

    expect(labelOf("Project")).toBeUndefined();
    await until(() => expect(fieldNamed("Workflow")).toBeDefined());
    expect(fieldNamed("Branch or tag").value).toBe("main");
    const options = [...(fieldNamed("Workflow") as HTMLSelectElement).options].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["Choose a workflow", "Release", "Deploy"]);
    expect(startButton()?.disabled).toBe(true);
    expect(startButton()?.title).toBe("Choose a workflow first.");
    expect(opened.textContent).not.toContain("dry_run");
  });

  it("offers the Projects Work › CI lists when the filter shows every Project, and tags as tags", async () => {
    await openStartWorkflow({}, []);

    const project = fieldNamed("Project") as HTMLSelectElement;
    expect([...project.options].map((option) => option.textContent)).toEqual([
      "Choose a Project",
      "Admin panel",
      "Billing",
    ]);
    fill(project, "admin-panel");
    await until(() => expect(fieldNamed("Branch or tag").value).toBe("main"));
    fill(fieldNamed("Branch or tag"), "v1");
    const labels = [...document.querySelectorAll('[role="option"]')].map((option) =>
      option.textContent.trim(),
    );
    expect(labels).toContain("v1.2.0 (tag)");
  });

  it("shows one control per input with its default, its description and its required mark", async () => {
    const opened = await openStartWorkflow();
    await until(() => expect(fieldNamed("Workflow")).toBeDefined());

    fill(fieldNamed("Workflow"), "release.yml");

    const dryRun = opened.querySelector('[role="switch"]');
    expect(dryRun?.getAttribute("aria-checked")).toBe("false");
    expect(dryRun?.closest("label")?.textContent).toContain("dry_run");
    expect(opened.textContent).toContain("Only show what it would publish");

    const channel = fieldNamed("channel");
    expect(channel).toBeInstanceOf(HTMLSelectElement);
    expect(channel.value).toBe("");
    expect([...(channel as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      "",
      "beta",
      "stable",
    ]);
    expect(labelOf("channel")?.textContent).toContain("*");
    expect(opened.textContent).toContain("Where the release goes");

    expect(fieldNamed("notes").value).toBe("Fixes");
    expect(fieldNamed("notes").getAttribute("type")).toBe("text");
    expect(labelOf("notes")?.textContent).not.toContain("*");
    expect(opened.textContent).toContain("A line for the release notes");
    expect(fieldNamed("shards").value).toBe("3");
    expect(fieldNamed("shards").getAttribute("type")).toBe("number");
    expect(fieldNamed("target").value).toBe("staging");
    expect(opened.textContent).toContain("The environment it deploys to");
  });

  it("keeps Start off until a required input has a value, then sends every value as text", async () => {
    const opened = await openStartWorkflow();
    await until(() => expect(fieldNamed("Workflow")).toBeDefined());
    fill(fieldNamed("Workflow"), "release.yml");

    expect(startButton()?.disabled).toBe(true);
    expect(startButton()?.title).toBe("Give channel a value first.");
    fill(fieldNamed("channel"), "stable");
    act(() => opened.querySelector<HTMLElement>('[role="switch"]')?.click());
    fill(fieldNamed("shards"), "5");
    expect(startButton()?.disabled).toBe(false);
    act(() => startButton()?.click());

    await until(() => {
      const call = sent.find(({ request }) => request === START_PATH);
      expect(call?.body).toEqual({
        ref: "main",
        inputs: {
          dry_run: "true",
          channel: "stable",
          notes: "Fixes",
          shards: "5",
          target: "staging",
        },
      });
    });
    await until(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(document.body.textContent).toContain("Release started on main.");
  });

  it("forgets the inputs entered when another workflow is chosen", async () => {
    await openStartWorkflow();
    await until(() => expect(fieldNamed("Workflow")).toBeDefined());
    fill(fieldNamed("Workflow"), "release.yml");
    fill(fieldNamed("notes"), "Something else");

    fill(fieldNamed("Workflow"), "deploy.yml");
    expect(labelOf("notes")).toBeUndefined();
    expect(startButton()?.disabled).toBe(false);
    fill(fieldNamed("Workflow"), "release.yml");
    expect(fieldNamed("notes").value).toBe("Fixes");
  });

  it("shows a refused start in the dialog", async () => {
    const opened = await openStartWorkflow({
      [START_PATH]: () => ({
        status: 422,
        body: { message: "channel must be one of beta, stable." },
      }),
    });
    await until(() => expect(fieldNamed("Workflow")).toBeDefined());
    fill(fieldNamed("Workflow"), "release.yml");
    fill(fieldNamed("channel"), "beta");
    act(() => startButton()?.click());

    await until(() => expect(opened.textContent).toContain("The workflow wasn't started"));
    expect(opened.textContent).toContain("channel must be one of beta, stable.");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("says when no workflow on the ref chosen can be started by hand", async () => {
    const opened = await openStartWorkflow({
      "GET /api/projects/admin-panel/workflows?ref=v1.2.0": () => ({
        status: 200,
        body: { ref: "v1.2.0", workflows: [], problem: null },
      }),
    });
    await until(() => expect(fieldNamed("Workflow")).toBeDefined());

    chooseRef("v1.2.0 (tag)");

    await until(() =>
      expect(opened.textContent).toContain("No workflow on v1.2.0 can be started by hand."),
    );
    expect(labelOf("Workflow")).toBeUndefined();
    expect(startButton()?.disabled).toBe(true);
  });

  it("shows why the workflows couldn't be read instead of a list", async () => {
    const opened = await openStartWorkflow({
      "GET /api/projects/admin-panel/workflows?ref=main": () => ({
        status: 200,
        body: {
          ref: "main",
          workflows: [],
          problem: "Sign in with GitHub in Settings › Office identity to read the workflows.",
        },
      }),
    });

    await until(() =>
      expect(opened.textContent).toContain(
        "Sign in with GitHub in Settings › Office identity to read the workflows.",
      ),
    );
    expect(opened.textContent).not.toContain("can be started by hand");
    expect(labelOf("Workflow")).toBeUndefined();
  });

  it("says once why nothing could be read when the branches and the workflows share the problem", async () => {
    const signIn = "Sign in with GitHub in Settings › Office identity to read the workflows.";
    const opened = await openStartWorkflow({
      "GET /api/projects/admin-panel/refs": () => ({
        status: 200,
        body: { branches: [], tags: [], baseBranch: "main", problem: signIn },
      }),
      "GET /api/projects/admin-panel/workflows?ref=main": () => ({
        status: 200,
        body: { ref: "main", workflows: [], problem: signIn },
      }),
    });

    await until(() => expect(opened.textContent).toContain(signIn));
    await until(() => expect(opened.textContent?.split(signIn)).toHaveLength(2));
    expect(opened.textContent).not.toContain("can be started by hand");
    expect(startButton()?.disabled).toBe(true);
  });
});
