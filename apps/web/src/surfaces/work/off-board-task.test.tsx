import type {
  OffBoardTask,
  Project,
  ProjectRunEnvironment,
  RunEnvironmentSetUpAnswer,
  Task,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
} from "../../shell/page.fixtures.tsx";
import { OffBoardTaskNote } from "./off-board-task-note.tsx";
import { setUpHintWords, settingUpWords } from "./off-board-task-words.ts";
import { RunEnvironmentNote, useAskedProject } from "./run-environment-question.tsx";

afterEach(closePage);

function aProject(fields: Partial<Project> = {}): Project {
  return {
    id: "notnullsoft",
    name: "notnullsoft",
    path: "/projects/notnullsoft",
    baseBranch: "main",
    mark: { label: "NO", colour: "teal" },
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
    ...fields,
  };
}

const SET_UP_TASK_ID = "5a1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

const SETTING_UP: OffBoardTask = {
  taskId: SET_UP_TASK_ID,
  projectId: "notnullsoft",
  title: "Set up the run environment",
  kind: "run-environment-setup",
  status: { state: "running" },
  stages: ["Set up", "Publish"],
  currentStage: "Set up",
  person: { roleKey: "devops", name: "Dwight" },
  threadId: null,
  since: "2026-11-22T10:00:00.000Z",
  tokens: 0,
};

const UNDECIDED: ProjectRunEnvironment = {
  runEnvironment: "not-decided",
  definition: { state: "not-found" },
  setUpProblems: [],
  setUpTask: null,
};

describe("the run environment question's words", () => {
  it("says Yes takes a running slot, and with a Project limit of 1 that this Task queues behind it", () => {
    expect(setUpHintWords("notnullsoft", 1)).toBe(
      "Yes starts an Off-board Task at once, off the board. It takes one of notnullsoft’s running slots while it runs, so with a Project limit of 1 this Task’s Start queues behind it.",
    );
    expect(setUpHintWords("notnullsoft", 3)).toBe(
      "Yes starts an Off-board Task at once, off the board. It takes one of notnullsoft’s running slots while it runs.",
    );
  });

  it("names who sets it up, or its place while it is queued", () => {
    expect(settingUpWords(SETTING_UP, "notnullsoft")).toBe(
      "Dwight is setting up notnullsoft’s run environment.",
    );
    const queued: OffBoardTask = {
      ...SETTING_UP,
      status: {
        state: "queued",
        place: 2,
        shortReasons: ["Project limit reached (1)"],
        queuedAt: "2026-11-22T10:00:00.000Z",
      },
    };
    expect(settingUpWords(queued, "notnullsoft")).toBe(
      "Set up the run environment is queued, place 2: Project limit reached (1).",
    );
  });
});

/** The question as Start's notes show it, on a Task of notnullsoft. */
function AskedNote(): ReactNode {
  const asked = useAskedProject("notnullsoft", true);
  return asked ? <RunEnvironmentNote asked={asked} /> : null;
}

function serviceWith(setUp: RunEnvironmentSetUpAnswer | { refused: readonly string[] }): void {
  stubService({
    "GET /api/projects/notnullsoft": () => ({ status: 200, body: aProject() }),
    "GET /api/projects/notnullsoft/run-environment": () => ({ status: 200, body: UNDECIDED }),
    "POST /api/projects/notnullsoft/run-environment/set-up": () => ({
      status: 200,
      body:
        "refused" in setUp
          ? { runEnvironment: UNDECIDED, start: { outcome: "refused", reasons: setUp.refused } }
          : setUp,
    }),
  });
}

describe("the run environment question", () => {
  it("shows the hint under Yes, then who is setting it up, linking to the Project's Run environment", async () => {
    serviceWith({
      runEnvironment: {
        ...UNDECIDED,
        setUpTask: { id: SET_UP_TASK_ID, title: SETTING_UP.title, state: "in-progress" },
      },
      start: { outcome: "started", offBoardTask: SETTING_UP },
    });
    const { page } = await openPage("/", { "/": AskedNote });
    await until(() => expect(buttonNamed(page, "Yes")).toBeDefined());
    expect(page.textContent).toContain("so with a Project limit of 1 this Task’s Start queues");

    act(() => buttonNamed(page, "Yes")?.click());

    await until(() =>
      expect(page.querySelector('[role="status"]')?.textContent).toBe(
        "Dwight is setting up notnullsoft’s run environment. Follow it on notnullsoft’s Run environment. It turns On when the Off-board Task is Done.",
      ),
    );
    expect(page.querySelector("a")?.getAttribute("href")).toBe(
      "/projects/notnullsoft/run-environment",
    );
    expect(buttonNamed(page, "Yes")).toBeUndefined();
  });

  it("keeps the question with every reason when the start is refused", async () => {
    serviceWith({ refused: ["Devops is held by nobody."] });
    const { page } = await openPage("/", { "/": AskedNote });
    await until(() => expect(buttonNamed(page, "Yes")).toBeDefined());

    act(() => buttonNamed(page, "Yes")?.click());

    await until(() => expect(page.textContent).toContain("Devops is held by nobody."));
    expect(page.textContent).toContain("The run environment's set-up didn't start");
    expect(buttonNamed(page, "Yes")).toBeDefined();
  });
});

function aTask(madeFor: Task["madeFor"]): Pick<Task, "madeFor" | "projectId"> {
  return { madeFor, projectId: "notnullsoft" };
}

async function noteOf(madeFor: Task["madeFor"]): Promise<HTMLElement> {
  stubService({});
  const task = aTask(madeFor);
  const { page } = await openPage("/", {
    "/": () => <OffBoardTaskNote task={task} projects={[aProject()]} />,
  });
  return page;
}

describe("the Task page's note on an Off-board Task", () => {
  it("says why it isn't on the board and links an Onboard Task to its Project's page", async () => {
    const page = await noteOf("onboard");
    expect(page.textContent).toBe(
      "The Office started this Off-board Task at once and keeps it off the Work board. Follow it here or on notnullsoft’s page.",
    );
    expect(page.querySelector("a")?.getAttribute("href")).toBe("/projects/notnullsoft");
  });

  it("links a run environment's set-up to the Project's Run environment", async () => {
    const page = await noteOf("run-environment-setup");
    expect(page.querySelector("a")?.getAttribute("href")).toBe(
      "/projects/notnullsoft/run-environment",
    );
  });

  it("says nothing on any other Task", async () => {
    expect((await noteOf(null)).textContent).toBe("");
    closePage();
    expect((await noteOf("publishing")).textContent).toBe("");
  });
});
