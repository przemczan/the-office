import {
  projectPipelineSchema,
  type ProjectPipeline,
  type Route,
  type Stage,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ProposalAppliers,
  ProposalRefused,
  type ProjectPipelineFields,
} from "../../../conversations/index.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import {
  aNewProjectPipeline,
  LINUX_CHECK,
  projectPipelineRequests,
} from "../http/project-pipeline-library.controller.fixtures.js";
import { aChangeTo, aNewOne } from "./project-pipeline-proposals.fixtures.js";
import { ANN_LEE } from "../../../conversations/index.fixtures.js";

// The test database is shared by every test file: these tests make Pipelines and Projects of their
// own, under names no one else uses, and never change the built-ins.

let pipelines: PipelinesApplication;
let url: string;

beforeAll(async () => {
  pipelines = await startPipelinesApplication();
  url = `${await pipelines.app.getUrl()}/api`;
});

afterAll(async () => {
  await pipelines.app.close();
});

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const { anOfficeWidePipeline, aProject, added } = projectPipelineRequests(
  send,
  () => pipelines.projects,
);

function appliers(): ProposalAppliers {
  return pipelines.app.get(ProposalAppliers);
}

async function read(id: string): Promise<ProjectPipeline> {
  const response = await send("GET", `/project-pipelines/${id}`);
  expect(response.status).toBe(200);
  return projectPipelineSchema.parse(await response.json());
}

/** The Stages with Verify on Linux after Tests, a straight line to End. */
function withLinux(stages: readonly Stage[]): Stage[] {
  return [
    ...stages.map((stage) =>
      stage.key === "tests" ? { ...stage, routes: [always("linux")] } : stage,
    ),
    { ...LINUX_CHECK, routes: [always(null)], place: { column: stages.length, row: 0 } },
  ];
}

const always = (to: string | null): Route => ({ to, condition: null });

describe("a Proposal of a Project Pipeline", () => {
  it("adds a new one with its whole flow when applied, answering it with its id, and never sets its Project's default", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const { projectId: _projectId, ...fields } = aNewProjectPipeline(projectId, base.id);
    const proposal = aNewOne(projectId, { ...fields, stages: withLinux(base.stages) });

    expect(await appliers().problemsWith(proposal)).toEqual([]);
    const applied = await appliers().apply(proposal, "devops", ANN_LEE);

    expect(applied).toEqual({ ...proposal, pipelineId: expect.any(String) });
    const pipelineId = applied.kind === "project-pipeline" ? applied.pipelineId : null;
    const saved = await read(pipelineId ?? "");
    expect(saved).toMatchObject({
      projectId,
      name: fields.name,
      copiedFrom: { name: base.name },
      brokenBeforeUpdate: null,
    });
    expect(saved.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
    expect(pipelines.projects.projects.find(({ id }) => id === projectId)?.defaultPipeline).toBe(
      "full",
    );
  });

  it("is refused for a new one copying Onboard, and for one copying another Project's own", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const othersOwn = await added(aNewProjectPipeline(aProject(), base.id));
    const { projectId: _projectId, ...fields } = aNewProjectPipeline(projectId, "onboard");

    expect(
      await appliers().problemsWith(aNewOne(projectId, { ...fields, stages: base.stages })),
    ).toContain("The Onboard Pipeline can't be copied into a Project.");
    expect(
      await appliers().problemsWith(
        aNewOne(projectId, { ...fields, copyOf: othersOwn.id, stages: base.stages }),
      ),
    ).toEqual([expect.stringContaining(othersOwn.id)]);
  });

  it("saves a change whole, every field as proposed", async () => {
    const base = await anOfficeWidePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));
    const proposal = aChangeTo(projectPipeline, {
      name: `${projectPipeline.name} and Linux`,
      description: "Linux last.",
      stages: withLinux(projectPipeline.stages),
    });

    const applied = await appliers().apply(proposal, "devops", ANN_LEE);

    expect(applied).toEqual(proposal);
    const saved = await read(projectPipeline.id);
    expect(saved).toMatchObject({
      name: `${projectPipeline.name} and Linux`,
      description: "Linux last.",
      copiedFrom: projectPipeline.copiedFrom,
    });
    expect(saved.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
  });

  it("doesn't count the Stages' names in routes as a change since it was drafted", async () => {
    const base = await anOfficeWidePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));
    const drafted = aChangeTo(projectPipeline, { description: "Proposed." });
    const proposal = {
      ...drafted,
      from: drafted.from && {
        ...drafted.from,
        stages: projectPipeline.stages.map((stage) => ({
          ...stage,
          routes: (stage.routes ?? []).map((route) => ({ ...route, toName: "Old" })),
        })),
      },
    };

    expect(await appliers().problemsWith(proposal)).toEqual([]);
  });

  it("is refused once the Project Pipeline changed since it was drafted, changing nothing", async () => {
    const base = await anOfficeWidePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));
    const proposal = aChangeTo(projectPipeline, { description: "Proposed." });
    const edited = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: "Edited by hand.",
      stages: projectPipeline.stages,
    });
    expect(edited.status).toBe(200);
    const reason = `${projectPipeline.name} changed since this was proposed.`;

    expect(await appliers().problemsWith(proposal)).toEqual([reason]);
    await expect(appliers().apply(proposal, "devops", ANN_LEE)).rejects.toThrow(ProposalRefused);
    expect((await read(projectPipeline.id)).description).toBe("Edited by hand.");
  });

  it("is refused as changed since, never applied, when drafted before Project Pipelines held their own flow", async () => {
    const base = await anOfficeWidePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));
    // As the previous release kept it: a base Pipeline and Stage changes, no Stages.
    const oldFields = {
      name: projectPipeline.name,
      description: projectPipeline.description,
      basePipelineId: base.id,
      stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: LINUX_CHECK }],
    } as unknown as ProjectPipelineFields;
    const oldChange = {
      ...aChangeTo(projectPipeline, {}),
      from: oldFields,
      to: { ...oldFields, description: "Proposed." },
    };
    const oldNew = aNewOne(projectPipeline.projectId, {
      ...oldFields,
      name: "Old new one",
    });

    const reason = `${projectPipeline.name} changed since this was proposed.`;
    expect(await appliers().problemsWith(oldChange)).toEqual([reason]);
    await expect(appliers().apply(oldChange, "devops", ANN_LEE)).rejects.toThrow(reason);
    expect(await appliers().problemsWith(oldNew)).toEqual([
      "Old new one changed since this was proposed.",
    ]);
    await expect(appliers().apply(oldNew, "devops", ANN_LEE)).rejects.toThrow(ProposalRefused);
    expect((await read(projectPipeline.id)).description).toBe(projectPipeline.description);
  });
});
