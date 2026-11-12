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
  projectPipelineRequests,
} from "../http/project-pipeline-library.controller.fixtures.js";
import { aChangeTo, aNewOne, fieldsOf } from "./project-pipeline-proposals.fixtures.js";

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

const { aBasePipeline, aProject, makeDefault, added } = projectPipelineRequests(
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

describe("a Proposal of a Project Pipeline, refused as the editor's save is", () => {
  it("refuses a name taken since, an unknown base Pipeline and an unknown Project", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const taken = await added(aNewProjectPipeline(projectId, base.id));

    const takenName = aNewOne(projectId, { ...fieldsOf(taken), name: taken.name.toUpperCase() });
    const unknownBase = aNewOne(projectId, {
      ...fieldsOf(taken),
      name: "Mine",
      basePipelineId: "none",
    });
    const unknownProject = aNewOne("no-such-project", { ...fieldsOf(taken), name: "Mine" });

    expect(await appliers().problemsWith(takenName)).toEqual([
      `Site ${projectId} has a Pipeline of its own named "${taken.name.toUpperCase()}".`,
    ]);
    expect(await appliers().problemsWith(unknownBase)).toContain(
      'There is no office-wide Pipeline "none" to build it from.',
    );
    expect(await appliers().problemsWith(unknownProject)).toEqual([
      'There is no Project "no-such-project".',
    ]);
    for (const proposal of [takenName, unknownBase, unknownProject]) {
      await expect(appliers().apply(proposal, "devops")).rejects.toThrow(ProposalRefused);
    }
  });

  it("refuses an unknown Project Pipeline, and one of another Project", async () => {
    const base = await aBasePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));
    const unknown = { ...aChangeTo(projectPipeline, { name: "Other" }), pipelineId: "none" };
    const anotherProjects = {
      ...aChangeTo(projectPipeline, { name: "Other" }),
      projectId: aProject(),
    };

    expect(await appliers().problemsWith(unknown)).toEqual([
      'There is no Project Pipeline "none".',
    ]);
    expect(await appliers().problemsWith(anotherProjects)).toEqual([
      `There is no Project Pipeline "${projectPipeline.id}".`,
    ]);
    await expect(appliers().apply(unknown, "devops")).rejects.toThrow(ProposalRefused);
    expect(await read(projectPipeline.id)).toEqual(projectPipeline);
  });

  it("refuses a Stage change naming a missing key, a command its Project lacks, and nothing changing", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const project = makeDefault(projectId, projectPipeline.id);
    const deploy = scriptStage({ key: "deploy", name: "Deploy", command: "deploy" });

    const missingKey = aChangeTo(projectPipeline, {
      stageChanges: [{ kind: "remove", stageKey: "lint" }],
    });
    const missingCommand = aChangeTo(projectPipeline, {
      stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: deploy }],
    });
    const nothing = aChangeTo(projectPipeline, {
      stageChanges: projectPipeline.stageChanges.map(
        ({ stageName: _stageName, ...unnamed }) => unnamed,
      ),
    });

    expect(await appliers().problemsWith(missingKey)).toEqual([
      "Removes lint, which isn't among the Stages.",
    ]);
    expect(await appliers().problemsWith(missingCommand)).toEqual([
      `Stage 3 · Deploy: ${project.name} has no command deploy (it is its default Pipeline)`,
    ]);
    expect(await appliers().problemsWith(nothing)).toEqual([
      "Nothing changes: give the Project Pipeline's name, description, base Pipeline or Stage changes as they should be.",
    ]);
    for (const proposal of [missingKey, missingCommand, nothing]) {
      await expect(appliers().apply(proposal, "devops")).rejects.toThrow(ProposalRefused);
    }
    expect(await read(projectPipeline.id)).toEqual(projectPipeline);
  });
});
