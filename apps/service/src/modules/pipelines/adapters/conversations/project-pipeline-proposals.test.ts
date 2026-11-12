import { projectPipelineSchema, type ProjectPipeline } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProposalAppliers, ProposalRefused } from "../../../conversations/index.js";
import { scriptStage } from "../../domain/stage.fixtures.js";
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

const { aBasePipeline, aProject, added } = projectPipelineRequests(send, () => pipelines.projects);

function appliers(): ProposalAppliers {
  return pipelines.app.get(ProposalAppliers);
}

async function read(id: string): Promise<ProjectPipeline> {
  const response = await send("GET", `/project-pipelines/${id}`);
  expect(response.status).toBe(200);
  return projectPipelineSchema.parse(await response.json());
}

describe("a Proposal of a Project Pipeline", () => {
  it("adds a new one when applied, answering it with its id, and never sets its Project's default", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const { projectId: _projectId, ...to } = aNewProjectPipeline(projectId, base.id);
    const proposal = aNewOne(projectId, to);

    expect(await appliers().problemsWith(proposal)).toEqual([]);
    const applied = await appliers().apply(proposal, "devops");

    expect(applied).toEqual({ ...proposal, pipelineId: expect.any(String) });
    const pipelineId = applied.kind === "project-pipeline" ? applied.pipelineId : null;
    expect(await read(pipelineId ?? "")).toMatchObject({
      projectId,
      name: to.name,
      basePipeline: { id: base.id, name: base.name },
      stageChanges: [
        { kind: "insert-after", stageKey: "tests", stageName: "Tests", stage: LINUX_CHECK },
      ],
      broken: [],
    });
    expect(pipelines.projects.projects.find(({ id }) => id === projectId)?.defaultPipeline).toBe(
      "full",
    );
  });

  it("saves a change whole, every field as proposed", async () => {
    const base = await aBasePipeline();
    const other = await aBasePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));
    const lint = scriptStage({ key: "lint", name: "Lint", command: "test" });
    const proposal = aChangeTo(projectPipeline, {
      name: `${projectPipeline.name} and lint`,
      description: "Lint first.",
      basePipelineId: other.id,
      stageChanges: [{ kind: "insert-before", stageKey: "tests", stage: lint }],
    });

    const applied = await appliers().apply(proposal, "devops");

    expect(applied).toEqual(proposal);
    expect(await read(projectPipeline.id)).toMatchObject({
      name: `${projectPipeline.name} and lint`,
      description: "Lint first.",
      basePipeline: { id: other.id, name: other.name },
      stageChanges: [{ kind: "insert-before", stageKey: "tests", stageName: "Tests", stage: lint }],
    });
  });

  it("is refused once the Project Pipeline changed since it was drafted, changing nothing", async () => {
    const base = await aBasePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));
    const proposal = aChangeTo(projectPipeline, { description: "Proposed." });
    const edited = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: "Edited by hand.",
      basePipelineId: base.id,
      stageChanges: projectPipeline.stageChanges,
    });
    expect(edited.status).toBe(200);
    const reason = `${projectPipeline.name} changed since this was proposed.`;

    expect(await appliers().problemsWith(proposal)).toEqual([reason]);
    await expect(appliers().apply(proposal, "devops")).rejects.toThrow(ProposalRefused);
    expect((await read(projectPipeline.id)).description).toBe("Edited by hand.");
  });
});
