import type { Project, Task } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { closePage, openPage, stubService } from "../../shell/page.fixtures.tsx";
import { OffBoardTaskNote } from "./off-board-task-note.tsx";

afterEach(closePage);

function aProject(fields: Partial<Project> = {}): Project {
  return {
    id: "notnullsoft",
    name: "notnullsoft",
    path: "/projects/notnullsoft",
    features: {
      "connected-devices": true,
      "test-targets": true,
      "github-issues": true,
      "run-environment": true,
      actions: true,
    },
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
    engine: {
      default: null,
      force: null,
      people: [],
      standIns: { useOwnList: false, engineIds: [] },
    },
    runEnvironment: "off",
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
