import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHOOSE_PIPELINE_ACTION } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProposalAppliers, ProposalRefused } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import type { Initiative } from "../../domain/initiative.js";
import { KnownProjectsForTests, SessionPeopleForTests } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { ANN_LEE as ANN_LEE_USER } from "../../../conversations/index.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The shaping session's Initiative, under a title of its own: Short names are Office-wide. */
let initiative: Initiative;
let shortName: string;
/** The Project the Initiative's one Task is in. */
let projectId: string;

const SESSION = "shaping-session";

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-choose-pipeline-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  shortName = `pipeline-sync-${randomUUID().slice(0, 8)}`;
  const idea = await work.app
    .get(IdeaService)
    .capture({ title: shortName, notes: "", projectId: undefined }, ANN_LEE);
  initiative = await work.app.get(InitiativeService).shape(idea.id, ANN_LEE);
  projectId = `project-${randomUUID()}`;
  await work.app
    .get(InitiativeService)
    .addTask(initiative.id, { title: "Queue writes", projectId, priority: "normal" }, [], ANN_LEE);
  work.app.get(SessionPeopleForTests).people.set(SESSION, "cto");
});

afterEach(async () => {
  await work.app.close();
});

function tool() {
  const [found] = work.app
    .get(OfficeToolRegistry)
    .named([CHOOSE_PIPELINE_ACTION.name], RUN_EVERY_CALL);
  if (!found) throw new Error(`No Office tool ${CHOOSE_PIPELINE_ACTION.name}.`);
  return found;
}

function call(input: Record<string, unknown>) {
  const given = tool().input.parse({ initiativeId: initiative.id, ...input });
  return tool().run(given, anOfficeToolCall(SESSION));
}

function current(): Promise<Initiative> {
  return work.app.get(InitiativeService).read(initiative.id);
}

async function confirmedOn(pipelineId: string | null): Promise<void> {
  await work.app
    .get(InitiativeService)
    .choosePipeline(initiative.id, projectId, pipelineId, "straight");
  await work.app.get(InitiativeService).confirm(initiative.id, ANN_LEE);
}

function proposed(pipelineId: string | null, inProject = projectId) {
  return {
    kind: "initiative",
    initiativeId: initiative.id,
    edit: { kind: "pipeline", projectId: inProject, pipelineId },
  } as const;
}

function pipelineOf(chosen: Initiative): string | undefined {
  return chosen.pipelines.find((entry) => entry.projectId === projectId)?.pipelineId;
}

describe("choose_pipeline", () => {
  it("sets the Initiative's Pipeline straight onto it while shaping, naming its Short name", async () => {
    const result = await call({ projectId, pipelineId: "full" });

    expect(result.isError).toBe(false);
    expect(result.text).toBe(
      `In ${projectId} the Initiative follows full now; its Short name is ${shortName}.`,
    );
    expect(await current()).toMatchObject({
      pipelines: [{ projectId, pipelineId: "full" }],
      shortName,
    });
  });

  it("is ruled no more freely than Proposal once the Initiative is active, not before", async () => {
    const input = { initiativeId: initiative.id, projectId, pipelineId: "quick-fix" };
    expect(await tool().authority?.floor?.(input)).toBeUndefined();

    await confirmedOn("full");

    expect(await tool().authority?.floor?.(input)).toBe("proposal");
  });

  it("applying it as the user changes the Pipeline, and refuses None once active", async () => {
    await confirmedOn("full");

    await tool().applyFor?.(
      tool().input.parse({ initiativeId: initiative.id, projectId, pipelineId: "quick-fix" }),
      { user: { userId: "ann", name: "Ann Lee" }, proposedBy: "cto" },
    );
    const none = await call({ projectId, pipelineId: null });

    expect(pipelineOf(await current())).toBe("quick-fix");
    expect(none).toEqual({
      text: `Whether the Initiative has a Pipeline in The ${projectId} was fixed at Confirm.`,
      isError: true,
    });
  });
});

describe("choose_pipeline's Project", () => {
  it("is refused for a Project the Initiative doesn't span", async () => {
    const elsewhere = `project-${randomUUID()}`;

    expect(await call({ projectId: elsewhere, pipelineId: "full" })).toEqual({
      text: `The Initiative has no Task in the Project "${elsewhere}", so it has no Pipeline there.`,
      isError: true,
    });
    expect((await current()).pipelines).toEqual([]);
  });
});

describe("a Proposal of another Pipeline", () => {
  it("changes the Initiative's Pipeline when the user applies it, keeping its Short name", async () => {
    await confirmedOn("full");
    const appliers = work.app.get(ProposalAppliers);

    expect(await appliers.problemsWith(proposed("quick-fix"))).toEqual([]);
    await appliers.apply(proposed("quick-fix"), "cto", ANN_LEE_USER);

    expect(await current()).toMatchObject({
      pipelines: [{ projectId, pipelineId: "quick-fix" }],
      shortName,
    });
  });

  it("is refused for an Initiative confirmed with None", async () => {
    await confirmedOn(null);
    const appliers = work.app.get(ProposalAppliers);

    expect(await appliers.problemsWith(proposed("full"))).toEqual([
      `Whether the Initiative has a Pipeline in The ${projectId} was fixed at Confirm.`,
    ]);
    await expect(appliers.apply(proposed("full"), "cto", ANN_LEE_USER)).rejects.toThrow(
      ProposalRefused,
    );
  });

  it("is refused when that Project lacks a command the Pipeline runs", async () => {
    await confirmedOn("full");
    work.app.get(KnownProjectsForTests).commands.set(projectId, []);
    const appliers = work.app.get(ProposalAppliers);

    expect(await appliers.problemsWith(proposed("quick-fix"))).toEqual([
      `The Pipeline Quick fix runs test, which The ${projectId} has no command for. Add it on the Project page, or choose another Pipeline.`,
    ]);
    await expect(appliers.apply(proposed("quick-fix"), "cto", ANN_LEE_USER)).rejects.toThrow(
      ProposalRefused,
    );
  });
});

describe("a Proposal of a Task in a Project the Initiative doesn't span yet", () => {
  it("isn't refused for a command that Project lacks, as it has None there", async () => {
    await confirmedOn("full");
    const newProjectId = `project-${randomUUID()}`;
    work.app.get(KnownProjectsForTests).commands.set(newProjectId, []);

    expect(
      await work.app.get(ProposalAppliers).problemsWith({
        kind: "initiative",
        initiativeId: initiative.id,
        edit: {
          kind: "add-task",
          title: "Export",
          projectId: newProjectId,
          priority: "normal",
          blockedBy: [],
          taskId: undefined,
        },
      }),
    ).toEqual([]);
  });
});
