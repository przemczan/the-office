import {
  projectPipelineSchema,
  type ProjectPipeline,
  type Route,
  type Stage,
} from "@the-office/contracts";
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

const { anOfficeWidePipeline, aProject, makeDefault, added } = projectPipelineRequests(
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
  it("refuses a name taken since, a new one copying no Pipeline or an unknown one, and an unknown Project", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const taken = await added(aNewProjectPipeline(projectId, base.id));
    const copy = { ...fieldsOf(taken), copyOf: base.id };

    const takenName = aNewOne(projectId, { ...copy, name: taken.name.toUpperCase() });
    const copyingNothing = aNewOne(projectId, { ...fieldsOf(taken), name: "Mine" });
    const unknownCopy = aNewOne(projectId, { ...copy, name: "Mine", copyOf: "none" });
    const unknownProject = aNewOne("no-such-project", { ...copy, name: "Mine" });

    expect(await appliers().problemsWith(takenName)).toEqual([
      `Site ${projectId} has a Pipeline of its own named "${taken.name.toUpperCase()}".`,
    ]);
    expect(await appliers().problemsWith(copyingNothing)).toEqual([
      "Name the Pipeline the new Project Pipeline copies.",
    ]);
    expect(await appliers().problemsWith(unknownCopy)).toEqual(['There is no Pipeline "none".']);
    expect(await appliers().problemsWith(unknownProject)).toEqual([
      'There is no Project "no-such-project".',
    ]);
    for (const proposal of [takenName, copyingNothing, unknownCopy, unknownProject]) {
      await expect(appliers().apply(proposal, "devops", ANN_LEE)).rejects.toThrow(ProposalRefused);
    }
  });

  it("refuses an unknown Project Pipeline, and one of another Project", async () => {
    const base = await anOfficeWidePipeline();
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
    await expect(appliers().apply(unknown, "devops", ANN_LEE)).rejects.toThrow(ProposalRefused);
    expect(await read(projectPipeline.id)).toEqual(projectPipeline);
  });

  it("refuses a flow that breaks a rule, a command its Project lacks, and nothing changing", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const project = makeDefault(projectId, projectPipeline.id);
    const deploy = scriptStage({ key: "deploy", name: "Deploy", command: "deploy" });
    const withRoutes = (key: string, routes: Route[]): Stage[] =>
      projectPipeline.stages.map((stage) => (stage.key === key ? { ...stage, routes } : stage));

    const brokenRule = aChangeTo(projectPipeline, { stages: withRoutes("tests", []) });
    const missingCommand = aChangeTo(projectPipeline, {
      stages: [
        ...withRoutes("tests", [{ to: "deploy", condition: null }]),
        { ...deploy, routes: [{ to: null, condition: null }], place: { column: 2, row: 0 } },
      ],
    });
    const nothing = aChangeTo(projectPipeline, {});

    expect(await appliers().problemsWith(brokenRule)).toContain(
      "Stage 2 · Tests: give it a route out; a final Stage's leads to End.",
    );
    expect(await appliers().problemsWith(missingCommand)).toEqual([
      `Stage 3 · Deploy: ${project.name} has no command deploy (it is its default Pipeline)`,
    ]);
    expect(await appliers().problemsWith(nothing)).toEqual([
      "Nothing changes: give the Project Pipeline's name, description or Stages as they should be, all of them.",
    ]);
    for (const proposal of [brokenRule, missingCommand, nothing]) {
      await expect(appliers().apply(proposal, "devops", ANN_LEE)).rejects.toThrow(ProposalRefused);
    }
    expect(await read(projectPipeline.id)).toEqual(projectPipeline);
  });
});
