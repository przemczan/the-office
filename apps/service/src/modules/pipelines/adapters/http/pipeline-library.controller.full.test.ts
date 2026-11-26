import { randomUUID } from "node:crypto";
import {
  pipelineCheckSchema,
  pipelineRemovalRefusalSchema,
  pipelineSchema,
  pipelineUseSchema,
  stagesEditRefusalSchema,
  type Pipeline,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import {
  PipelineAdded,
  PipelineRemoved,
  PipelineSaved,
} from "../../domain/pipeline-library-events.js";
import { withGivenLimits } from "../../domain/flow.js";
import { agentStage, scriptStage, straightLine } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { anEdit } from "./pipeline-library.controller.fixtures.js";
import {
  aNewProjectPipeline,
  projectPipelineRequests,
} from "./project-pipeline-library.controller.fixtures.js";

// The test database is shared by every test file: these tests make Pipelines of their own, under
// names no one else uses, and never change the built-ins.

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

function publishedFor(
  type: typeof PipelineAdded | typeof PipelineSaved | typeof PipelineRemoved,
  pipelineId: string,
): boolean {
  return pipelines.published.some(
    (event) => event instanceof type && event.pipelineId === pipelineId,
  );
}

async function added(body: unknown = anEdit()): Promise<Pipeline> {
  const response = await send("POST", "/pipelines", body);
  expect(response.status).toBe(201);
  return pipelineSchema.parse(await response.json());
}

describe("POST /api/pipelines", () => {
  it("adds a copy of a Pipeline, with (copy) and then a number after its name", async () => {
    const original = await added();

    const first = await added({ copyOf: original.id });
    const second = await added({ copyOf: original.id });

    expect(first).toEqual({ ...original, id: first.id, name: `${original.name} (copy)` });
    expect(second.name).toBe(`${original.name} (copy 2)`);
    expect(new Set([original.id, first.id, second.id]).size).toBe(3);
  });

  it("refuses a copy of a Pipeline the library doesn't have", async () => {
    const response = await send("POST", "/pipelines", { copyOf: "nowhere" });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: 'There is no Pipeline "nowhere".' });
  });

  it("adds a Pipeline with an Agent Stage for a Role nobody fills", async () => {
    const edit = anEdit({ stages: [agentStage({ role: "devops" })] });

    const pipeline = await added(edit);

    expect(pipeline.stages).toEqual(straightLine(edit.stages));
  });

  it("keeps an Agent Stage's Project commands, and reads them back the same", async () => {
    const edit = anEdit({ stages: [agentStage({ permissions: { commands: ["test"] } })] });
    const pipeline = await added(edit);

    const read = await send("GET", `/pipelines/${pipeline.id}`);

    expect(pipelineSchema.parse(await read.json()).stages).toEqual(straightLine(edit.stages));
  });

  it("refuses an Agent Stage whose Project commands are an empty list, or name install", async () => {
    const empty = await send(
      "POST",
      "/pipelines",
      anEdit({ stages: [agentStage({ permissions: { commands: [] } })] }),
    );
    const install = await send(
      "POST",
      "/pipelines",
      anEdit({ stages: [agentStage({ permissions: { commands: ["install"] } })] }),
    );

    expect(empty.status).toBe(400);
    expect(install.status).toBe(400);
  });
});

/** A Role of its own per test, which no other Pipeline in the shared library names. */
function anIncapableRole(): string {
  const roleKey = `translator-${randomUUID()}`;
  pipelines.roleEngines.incapableRoles.add(roleKey);
  return roleKey;
}

function incapableRefusal(roleKey: string) {
  return {
    stageKey: null,
    at: null,
    level: "problem",
    text: `The ${roleKey}'s engine can't work an Agent Stage.`,
  };
}

describe("a Stage naming a Role whose engine can't work an Agent Stage", () => {
  it("is refused in a new Pipeline, weighed outside any Project and in every Project", async () => {
    const roleKey = anIncapableRole();

    const response = await send(
      "POST",
      "/pipelines",
      anEdit({ stages: [agentStage({ role: roleKey })] }),
    );

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual([
      incapableRefusal(roleKey),
    ]);
    expect(pipelines.roleEngines.asked.at(-1)).toEqual({
      roleKeys: [roleKey],
      dutyKeys: [],
      projectId: undefined,
    });
  });

  it("is refused on a save and in a Proposal's Stages, and named by the check before Save", async () => {
    const pipeline = await added();
    const roleKey = anIncapableRole();
    const edit = anEdit({ stages: [agentStage({ role: roleKey })] });

    const saved = await send("PUT", `/pipelines/${pipeline.id}`, edit);
    const checked = await send("POST", "/pipelines/check", { ...edit, pipelineId: pipeline.id });
    const proposed = pipelines.app
      .get(PipelineLibraryEditor)
      .proposedStagesProblems(pipeline.id, withGivenLimits(pipeline.stages), edit.stages);

    expect(saved.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await saved.json()).problems).toEqual([
      incapableRefusal(roleKey),
    ]);
    // The check also warns that nobody fills the Role, which a save alone wouldn't refuse.
    expect(pipelineCheckSchema.parse(await checked.json()).problems).toEqual([
      incapableRefusal(roleKey),
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "warning",
        text: `Stage 1 · Implement: nobody fills ${roleKey}; hire someone or choose who works it.`,
      },
    ]);
    expect(await proposed).toEqual([{ level: "problem", text: incapableRefusal(roleKey).text }]);
  });

  it("lets through a Role the library already names, whatever its engine", async () => {
    const roleKey = `translator-${randomUUID()}`;
    const named = await added(anEdit({ stages: [agentStage({ role: roleKey })] }));
    pipelines.roleEngines.incapableRoles.add(roleKey);

    expect((await added({ copyOf: named.id })).stages).toEqual(named.stages);
    expect((await added(anEdit({ stages: withGivenLimits(named.stages) }))).stages).toEqual(
      named.stages,
    );
  });
});

describe("POST /api/pipelines/check", () => {
  it("flags a Role nobody fills, which Save allows, apart from what it refuses", async () => {
    const pipeline = await added();

    const response = await send("POST", "/pipelines/check", {
      ...anEdit({ name: "Full", stages: [agentStage({ role: "devops" })] }),
      pipelineId: pipeline.id,
    });

    expect(response.status).toBe(200);
    expect(pipelineCheckSchema.parse(await response.json())).toEqual({
      problems: [
        { stageKey: null, at: null, level: "problem", text: 'Another Pipeline is named "Full".' },
        {
          stageKey: "implement",
          at: { kind: "stage" },
          level: "warning",
          text: "Stage 1 · Implement: nobody fills Devops; hire someone or choose who works it.",
        },
      ],
    });
  });

  it("flags Stage permissions wider than the Role card's, which Save keeps", async () => {
    const edit = anEdit({ stages: [agentStage({ permissions: { run: "anything", web: false } })] });

    const response = await send("POST", "/pipelines/check", edit);

    expect(pipelineCheckSchema.parse(await response.json())).toEqual({
      problems: [
        {
          stageKey: "implement",
          at: { kind: "stage" },
          level: "warning",
          text: "Stage 1 · Implement: the run permission can only be narrowed from the Role card's.",
        },
      ],
    });
    expect((await added(edit)).stages).toEqual(straightLine(edit.stages));
  });

  it("refuses a Stage that would give back editing", async () => {
    const response = await send("POST", "/pipelines/check", {
      ...anEdit(),
      stages: [{ ...agentStage(), permissions: { edit: true } }],
    });

    expect(response.status).toBe(400);
  });

  it("doesn't count the Pipeline being saved as taking its own name", async () => {
    const pipeline = await added();

    const response = await send("POST", "/pipelines/check", {
      name: pipeline.name,
      description: pipeline.description,
      stages: pipeline.stages,
      pipelineId: pipeline.id,
    });

    expect(pipelineCheckSchema.parse(await response.json())).toEqual({
      problems: [],
    });
  });
});

describe("PUT /api/pipelines/:id", () => {
  it("keeps a Pipeline's own name when only its Stages change", async () => {
    const pipeline = await added();

    const response = await send("PUT", `/pipelines/${pipeline.id}`, {
      ...anEdit({ stages: [scriptStage({ key: "build", name: "Build", command: "build" })] }),
      name: pipeline.name,
    });

    expect(response.status).toBe(200);
  });

  it("refuses Stages that can't run, on the Stage each problem concerns", async () => {
    const pipeline = await added();

    const response = await send(
      "PUT",
      `/pipelines/${pipeline.id}`,
      anEdit({
        name: " ",
        stages: [scriptStage({ routes: [{ to: "x", condition: null, limit: null }] })],
      }),
    );

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual([
      { stageKey: null, at: null, level: "problem", text: "Give the Pipeline a name." },
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: "Stage 1 · Tests: its route to x leads to a Stage the Pipeline doesn't have.",
      },
    ]);
  });

  it("answers 404 for a Pipeline the library doesn't have", async () => {
    expect((await send("PUT", "/pipelines/nowhere", anEdit())).status).toBe(404);
  });
});

describe("DELETE /api/pipelines/:id", () => {
  it("removes a Pipeline nobody needs, though a running Task keeps its copy", async () => {
    const pipeline = await added();
    pipelines.tasks.put(randomUUID(), { state: "in-progress", pipelineId: pipeline.id });

    const response = await send("DELETE", `/pipelines/${pipeline.id}`);

    expect(response.status).toBe(204);
    expect((await send("GET", `/pipelines/${pipeline.id}`)).status).toBe(404);
    expect(publishedFor(PipelineRemoved, pipeline.id)).toBe(true);
  });

  it("always refuses the Onboard Pipeline, which onboarding uses", async () => {
    const response = await send("DELETE", "/pipelines/onboard");

    expect(response.status).toBe(422);
    expect(pipelineRemovalRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Onboarding uses the Onboard Pipeline, so it stays in the library.",
    ]);
  });

  it("answers 404 for a Pipeline the library doesn't have", async () => {
    expect((await send("DELETE", "/pipelines/nowhere")).status).toBe(404);
  });
});

describe("GET /api/pipelines/:id/use", () => {
  it("names the Projects whose default it is and counts its Tasks not started and running", async () => {
    const pipeline = await added();
    const projectId = randomUUID();
    pipelines.projects.projects.push({
      id: projectId,
      name: "App",
      defaultPipeline: pipeline.id,
      commands: [],
    });
    for (const state of ["backlog", "planning", "paused", "done"]) {
      pipelines.tasks.put(randomUUID(), { state, pipelineId: pipeline.id });
    }

    const response = await send("GET", `/pipelines/${pipeline.id}/use`);

    expect(response.status).toBe(200);
    expect(pipelineUseSchema.parse(await response.json())).toEqual({
      defaultFor: [{ projectId, name: "App" }],
      notStarted: 2,
      running: 1,
      initiatives: 0,
    });
  });
});

describe("an office-wide Pipeline and the Project Pipelines copied from it", () => {
  const {
    anOfficeWidePipeline,
    aProject,
    makeDefault,
    added: addedProjectPipeline,
  } = projectPipelineRequests(send, () => pipelines.projects);

  it("saves a command a copy's Project lacks: the copy keeps its own Stages", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject(["test"]);
    const projectPipeline = await addedProjectPipeline(aNewProjectPipeline(projectId, source.id));
    makeDefault(projectId, projectPipeline.id);
    makeDefault(aProject(["test", "lint"]), source.id);
    const lint = scriptStage({ key: "tests", name: "Lint", command: "lint" });

    const response = await send("PUT", `/pipelines/${source.id}`, {
      name: source.name,
      description: source.description,
      stages: straightLine(withGivenLimits([source.stages[0]!, lint])),
    });

    expect(response.status).toBe(200);
  });

  it("refuses an office-wide name a Project Pipeline has, naming its Project", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await addedProjectPipeline(aNewProjectPipeline(projectId, source.id));

    const response = await send("POST", "/pipelines", anEdit({ name: projectPipeline.name }));

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).reasons).toEqual([
      `Site ${projectId} has a Pipeline of its own named "${projectPipeline.name}".`,
    ]);
  });
});
