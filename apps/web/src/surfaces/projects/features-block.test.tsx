import { useQuery } from "@tanstack/react-query";
import type { Project, ProjectFeatures, ProjectRunEnvironment } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { projectQueries } from "../../api/projects.ts";
import {
  closePage,
  openPage,
  shownText,
  stubService,
  until,
  type Answers,
} from "../../shell/page.fixtures.tsx";
import { FeaturesBlock } from "./features-block.tsx";
import { offBoardTask } from "./off-board-task.fixtures.tsx";

const ALL_ON: ProjectFeatures = {
  "connected-devices": true,
  "test-targets": true,
  "github-issues": true,
  "run-environment": true,
  actions: true,
};

const PROJECT: Project = {
  id: "shop",
  name: "Shop",
  path: "/projects/shop",
  baseBranch: "main",
  mark: { label: "SH", colour: "teal" },
  installCommand: "npm ci",
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
  engine: {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: [] },
  },
  runEnvironment: "on",
  features: ALL_ON,
  projectLimit: 1,
  addedAt: "2026-11-01T10:00:00.000Z",
  codeHost: "GitHub",
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  issueSettings: {
    autoImportLabel: null,
    closeOnDone: true,
    commentOnStartAndDone: false,
    closeOnDrop: false,
  },
};

const RUN_ENVIRONMENT_OFF: Project = {
  ...PROJECT,
  runEnvironment: "off",
  features: { ...ALL_ON, "connected-devices": false, "run-environment": false },
};

function runEnvironmentOf(
  project: Project,
  setUpTask: ProjectRunEnvironment["setUpTask"] = null,
): ProjectRunEnvironment {
  return {
    runEnvironment: project.runEnvironment,
    definition: { state: "not-found" },
    setUpProblems: [],
    setUpTask,
  };
}

/** The block as the page shows it: reading the Project, so a saved answer redraws it. */
function Shown(): ReactNode {
  const project = useQuery(projectQueries.one(PROJECT.id)).data;
  return project ? <FeaturesBlock project={project} /> : null;
}

function answers(project: Project, more: Answers = {}): Answers {
  return {
    [`GET /api/projects/${PROJECT.id}`]: () => ({ status: 200, body: project }),
    [`GET /api/projects/${PROJECT.id}/run-environment`]: () => ({
      status: 200,
      body: runEnvironmentOf(project),
    }),
    ...more,
  };
}

async function shown(): Promise<HTMLElement> {
  const { page } = await openPage("/", { "/": () => <Shown /> });
  await until(() => expect(page.querySelector('[role="group"]')).not.toBeNull());
  return page;
}

function rowOf(page: HTMLElement, name: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`);
  if (!row) throw new Error(`There is no row for ${name}.`);
  return row;
}

function switchOf(page: HTMLElement, name: string): HTMLElement {
  const found = rowOf(page, name).querySelector<HTMLElement>('[role="switch"]');
  if (!found) throw new Error(`${name} has no switch.`);
  return found;
}

function click(element: HTMLElement): void {
  act(() => element.click());
}

describe("the Features tab", () => {
  afterEach(closePage);

  it("shows a row per feature with its hint and its switch as the Project reads it", async () => {
    stubService(answers({ ...PROJECT, features: { ...ALL_ON, "github-issues": false } }));
    const page = await shown();

    const names = [...page.querySelectorAll('[role="group"]')].map((row) =>
      row.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      "Connected devices",
      "Test targets",
      "GitHub issues",
      "Run environment",
      "Actions",
    ]);
    expect(shownText(rowOf(page, "Actions"))).toContain(
      "Things to run on demand, outside the Task queue.",
    );
    expect(shownText(rowOf(page, "Connected devices"))).toContain(
      "Devices connected to a Task or kept for the Project.",
    );
    expect(switchOf(page, "Actions").getAttribute("aria-checked")).toBe("true");
    expect(shownText(rowOf(page, "Test targets"))).toContain(
      "What can be launched on an Initiative's branch to try the work.",
    );
    expect(switchOf(page, "Test targets").getAttribute("aria-checked")).toBe("true");
    expect(switchOf(page, "GitHub issues").getAttribute("aria-checked")).toBe("false");
  });

  it("saves a switch at once and shows the Project as the service answers", async () => {
    const sent = stubService(
      answers(PROJECT, {
        [`PUT /api/projects/${PROJECT.id}/features`]: () => ({
          status: 200,
          body: { ...PROJECT, features: { ...ALL_ON, "test-targets": false } },
        }),
      }),
    );
    const page = await shown();

    click(switchOf(page, "Test targets"));

    await until(() =>
      expect(switchOf(page, "Test targets").getAttribute("aria-checked")).toBe("false"),
    );
    expect(sent.find(({ request }) => request.startsWith("PUT"))?.body).toEqual({
      features: { "test-targets": false },
    });
  });

  it("shows a refused change's words under the block", async () => {
    stubService(
      answers(PROJECT, {
        [`PUT /api/projects/${PROJECT.id}/features`]: () => ({
          status: 422,
          body: {
            message: "Not changed.",
            reasons: ["Connected devices need Run environment, which is off for «Shop»."],
          },
        }),
      }),
    );
    const page = await shown();

    click(switchOf(page, "Connected devices"));

    await until(() =>
      expect(shownText(page)).toContain(
        "Connected devices need Run environment, which is off for «Shop».",
      ),
    );
  });

  it("holds Connected devices while Run environment is off, saying why", async () => {
    const sent = stubService(answers(RUN_ENVIRONMENT_OFF));
    const page = await shown();

    expect(shownText(rowOf(page, "Connected devices"))).toContain("Needs Run environment");
    click(switchOf(page, "Connected devices"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(sent.some(({ request }) => request.startsWith("PUT"))).toBe(false);
  });

  it("shows Run environment Not decided as off, and turns it on as Set up does", async () => {
    const notDecided: Project = { ...RUN_ENVIRONMENT_OFF, runEnvironment: "not-decided" };
    const sent = stubService(
      answers(notDecided, {
        [`POST /api/projects/${PROJECT.id}/run-environment/set-up`]: () => ({
          status: 200,
          body: {
            runEnvironment: runEnvironmentOf(notDecided, {
              id: "task-1",
              title: "Set up the run environment",
              state: "ready",
            }),
            start: {
              outcome: "started",
              offBoardTask: offBoardTask(
                { state: "running" },
                { title: "Set up the run environment", kind: "run-environment-setup" },
              ),
            },
          },
        }),
      }),
    );
    const page = await shown();

    expect(switchOf(page, "Run environment").getAttribute("aria-checked")).toBe("false");
    expect(shownText(rowOf(page, "Run environment"))).toContain("Not decided yet");

    click(switchOf(page, "Run environment"));

    await until(() =>
      expect(shownText(rowOf(page, "Run environment"))).toContain(
        "Being set up in the Task Set up the run environment",
      ),
    );
    expect(sent.map(({ request }) => request)).toContain(
      `POST /api/projects/${PROJECT.id}/run-environment/set-up`,
    );
  });

  it("turns Run environment off with the Run environment setting", async () => {
    const sent = stubService(
      answers(PROJECT, {
        [`PUT /api/projects/${PROJECT.id}/run-environment`]: () => ({
          status: 200,
          body: runEnvironmentOf(RUN_ENVIRONMENT_OFF),
        }),
      }),
    );
    const page = await shown();

    click(switchOf(page, "Run environment"));

    await until(() =>
      expect(sent.find(({ request }) => request.startsWith("PUT"))?.body).toEqual({
        runEnvironment: "off",
      }),
    );
  });
});
