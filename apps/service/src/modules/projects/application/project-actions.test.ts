import { describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { ActionFields } from "../domain/action.js";
import type { ManualWorkflow } from "../domain/manual-workflow.js";
import { aProject } from "../domain/project.fixtures.js";
import type { Project } from "../domain/project.js";
import { ProjectActionsChanged } from "../domain/project-events.js";
import { FeatureSwitchedOff } from "../domain/project-features.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { TestTarget } from "../domain/test-target.js";
import { InMemoryActionRepository } from "../ports/action-repository.fixtures.js";
import type { TestTargetRepository } from "../ports/test-target-repository.js";
import type { ManualWorkflowList, ManualWorkflows } from "./manual-workflows.js";
import { ProjectActions } from "./project-actions.js";
import type { ProjectService } from "./project-service.js";

const RELEASE_WORKFLOW: ManualWorkflow = {
  id: "release.yml",
  name: "Release",
  url: "https://github.com/acme/admin-panel/actions/workflows/release.yml",
  inputs: [
    {
      name: "channel",
      description: "",
      required: true,
      default: null,
      kind: "choice",
      options: ["beta", "stable"],
    },
    {
      name: "dry-run",
      description: "",
      required: false,
      default: "false",
      kind: "yes-no",
      options: [],
    },
  ],
};

const BUILD: ActionFields = {
  key: "build-web",
  name: "Build web",
  kind: "project-command",
  settings: { commandKey: "build", commandsBefore: ["install"], timeLimitMinutes: 30 },
  leavesTheWorkstation: false,
};

const RELEASE: ActionFields = {
  key: "release",
  name: "Release",
  kind: "workflow",
  settings: { file: "release.yml", inputs: { channel: "stable" } },
  leavesTheWorkstation: false,
};

const ANN = { userId: "user-ann", name: "Ann" };
const BY_ANN = { by: "user", user: ANN } as const;
const DANA = { proposalId: "proposal-1", agent: { roleKey: "devops", name: "Dana" } };

function setUp(project: Project = aProject()) {
  const projects = new Map([[project.id, project]]);
  const service: Pick<ProjectService, "read" | "find"> = {
    find: async (id) => projects.get(id),
    read: async (id) => {
      const found = projects.get(id);
      if (!found) throw new ProjectNotFound(id);
      return found;
    },
  };
  const testTargets: Pick<TestTargetRepository, "listOf"> = {
    listOf: async () => [{ key: "android" } as TestTarget],
  };
  let listing: ManualWorkflowList = {
    ref: project.baseBranch,
    workflows: [RELEASE_WORKFLOW],
    problem: null,
  };
  let listed = 0;
  const workflows: Pick<ManualWorkflows, "list"> = {
    list: async () => {
      listed += 1;
      return listing;
    },
  };
  const repository = new InMemoryActionRepository();
  const events = new EventBus();
  const published: DomainEvent[] = [];
  events.subscribeToEveryEvent((event) => void published.push(event));
  const actions = new ProjectActions(
    service as ProjectService,
    repository,
    testTargets as TestTargetRepository,
    workflows as ManualWorkflows,
    events,
  );
  return {
    actions,
    repository,
    published,
    projects,
    listedTimes: () => listed,
    listWorkflows: (next: ManualWorkflowList) => {
      listing = next;
    },
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<readonly string[]> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ProjectRefused);
  return (error as ProjectRefused).reasons;
}

describe("ProjectActions.change", () => {
  it("saves the page's list set by the user, Leaves the workstation as sent", async () => {
    const { actions, published } = setUp();

    const saved = await actions.change(
      "admin-panel",
      [BUILD, { ...RELEASE, leavesTheWorkstation: true }],
      ANN,
    );

    const setByAnn = {
      name: BY_ANN,
      kind: BY_ANN,
      settings: BY_ANN,
      leavesTheWorkstation: BY_ANN,
    };
    expect(saved).toEqual([
      { ...BUILD, setBy: setByAnn },
      { ...RELEASE, leavesTheWorkstation: true, setBy: setByAnn },
    ]);
    expect(await actions.list("admin-panel")).toEqual(saved);
    expect(published[0]).toBeInstanceOf(ProjectActionsChanged);
    expect(published).toEqual([
      expect.objectContaining({ projectId: "admin-panel", removedKeys: [] }),
    ]);
  });

  it("lets the user clear the mark, as they add a Workflow or later, and names the keys removed", async () => {
    const { actions, published } = setUp();
    await actions.change("admin-panel", [BUILD, { ...RELEASE, leavesTheWorkstation: true }], ANN);
    published.length = 0;

    const saved = await actions.change("admin-panel", [RELEASE], ANN);

    expect(saved).toEqual([
      expect.objectContaining({ key: "release", leavesTheWorkstation: false }),
    ]);
    expect(published).toEqual([
      expect.objectContaining({ projectId: "admin-panel", removedKeys: ["build-web"] }),
    ]);
    expect(await actions.change("admin-panel", [{ ...RELEASE, key: "release-beta" }], ANN)).toEqual(
      [expect.objectContaining({ key: "release-beta", leavesTheWorkstation: false })],
    );
  });

  it("saves nothing and tells nobody when nothing changed, asking the code host nothing", async () => {
    const { actions, published, listedTimes } = setUp();
    await actions.change("admin-panel", [BUILD, { ...RELEASE, leavesTheWorkstation: true }], ANN);
    published.length = 0;
    const before = listedTimes();

    await actions.change("admin-panel", [BUILD, { ...RELEASE, leavesTheWorkstation: true }], ANN);

    expect(published).toEqual([]);
    expect(listedTimes()).toBe(before);
  });

  it("refuses a Workflow the base branch doesn't declare, or inputs it doesn't, naming them", async () => {
    const { actions, repository } = setUp();

    expect(
      await refusalOf(
        actions.change(
          "admin-panel",
          [
            { ...RELEASE, settings: { file: "deploy.yml", inputs: {} } },
            {
              ...RELEASE,
              key: "beta",
              settings: { file: "release.yml", inputs: { flavour: "mint", channel: "nightly" } },
            },
          ],
          ANN,
        ),
      ),
    ).toEqual([
      `Action "release": deploy.yml doesn't declare a start by hand on main.`,
      `Action "beta": flavour isn't an input release.yml declares on main.`,
      `Action "beta": release.yml's channel is "nightly", not one of its options: beta, stable.`,
    ]);
    expect(await repository.listOf("admin-panel")).toEqual([]);
  });

  it("refuses a Workflow it can't check, in the code host's words", async () => {
    const { actions, listWorkflows } = setUp();
    listWorkflows({ ref: "main", workflows: [], problem: "GitHub couldn't be reached." });

    expect(await refusalOf(actions.change("admin-panel", [RELEASE], ANN))).toEqual([
      `Action "release": release.yml can't be checked on main: GitHub couldn't be reached.`,
    ]);
  });

  it("refuses a Project command Action while a Project variable takes a name The Office sets", async () => {
    const { actions } = setUp(
      aProject({
        environment: {
          set: [{ name: "OFFICE_ACTION_COMMIT", value: "x", secret: true }],
          unset: [],
          prependPath: [],
        },
      }),
    );

    expect(await refusalOf(actions.change("admin-panel", [BUILD], ANN))).toEqual([
      `Action "build-web": OFFICE_ACTION_COMMIT is a variable The Office sets in an Action's run; rename the Project variable.`,
    ]);
  });

  it("refuses every write while Actions are switched off, but lists them", async () => {
    const { actions, projects } = setUp();
    await actions.change("admin-panel", [BUILD], ANN);
    projects.set("admin-panel", aProject({ features: { actions: false } }));

    await expect(actions.change("admin-panel", [], ANN)).rejects.toThrowError(
      new FeatureSwitchedOff("actions", "Admin panel"),
    );
    await expect(actions.change("admin-panel", [], ANN)).rejects.toThrow(
      "Actions are switched off for «Admin panel».",
    );
    expect(await actions.list("admin-panel")).toHaveLength(1);
  });
});

describe("a Proposal of Actions", () => {
  it("is drafted, checked and applied all or nothing, set by the Proposal", async () => {
    const { actions, published } = setUp();
    await actions.change("admin-panel", [BUILD], ANN);
    published.length = 0;

    const proposed = await actions.propose("admin-panel", {
      actions: [RELEASE],
      removeActions: ["build-web"],
      changeUserSet: [
        "build-web.name",
        "build-web.kind",
        "build-web.settings",
        "build-web.leavesTheWorkstation",
      ],
    });
    expect(proposed.actions.map(({ key, to }) => [key, to?.leavesTheWorkstation ?? null])).toEqual([
      ["release", true],
      ["build-web", null],
    ]);
    expect(await actions.proposedProblems("admin-panel", proposed)).toEqual([]);

    await actions.changeAsProposed("admin-panel", proposed, DANA);

    const byDana = { by: "proposal", ...DANA };
    expect(await actions.list("admin-panel")).toEqual([
      {
        ...RELEASE,
        leavesTheWorkstation: true,
        setBy: { name: byDana, kind: byDana, settings: byDana, leavesTheWorkstation: byDana },
      },
    ]);
    expect(published).toEqual([
      expect.objectContaining({ projectId: "admin-panel", removedKeys: ["build-web"] }),
    ]);
  });

  it("is refused once what it changes changed, and while Actions are switched off", async () => {
    const { actions, projects } = setUp();
    await actions.change("admin-panel", [BUILD], ANN);
    const proposed = await actions.propose("admin-panel", {
      actions: [{ ...BUILD, name: "Build" }],
      changeUserSet: ["build-web.name"],
    });
    await actions.change("admin-panel", [{ ...BUILD, name: "Build it" }], ANN);

    expect(await actions.proposedProblems("admin-panel", proposed)).toEqual([
      `Action "build-web" changed since this was proposed.`,
    ]);
    await expect(actions.changeAsProposed("admin-panel", proposed, DANA)).rejects.toThrow(
      ProjectRefused,
    );

    projects.set("admin-panel", aProject({ features: { actions: false } }));
    expect(await actions.proposedProblems("admin-panel", proposed)).toEqual([
      "Actions are switched off for «Admin panel».",
    ]);
    await expect(actions.propose("admin-panel", { actions: [RELEASE] })).rejects.toThrow(
      FeatureSwitchedOff,
    );
  });
});
