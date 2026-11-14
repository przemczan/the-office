import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProposalAppliers, ProposalRefused } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import type { Initiative } from "../../domain/initiative.js";
import {
  KnownProjectsForTests,
  ProposalDraftsForTests,
  SessionInitiativesForTests,
} from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { SHAPING_OFFICE_TOOLS } from "../conversations/initiative-thread-records.js";
import { CHOOSE_PIPELINE } from "./shaping-office-tools.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { ANN_LEE as ANN_LEE_USER } from "../../../conversations/index.fixtures.js";

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
  work.app.get(SessionInitiativesForTests).initiatives.set(SESSION, initiative.id);
});

afterEach(async () => {
  await work.app.close();
});

function call(input: Record<string, unknown>) {
  const [tool] = work.app.get(OfficeToolRegistry).named([CHOOSE_PIPELINE]);
  if (!tool) throw new Error(`No Office tool ${CHOOSE_PIPELINE}.`);
  return tool.run(input, anOfficeToolCall(SESSION));
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
  it("is among a shaping session's Office tools", () => {
    expect(SHAPING_OFFICE_TOOLS).toContain(CHOOSE_PIPELINE);
  });

  it("sets the Initiative's Pipeline straight onto it while shaping, naming its Short name and that it has no Gate", async () => {
    const result = await call({ projectId, pipelineId: "full" });

    expect(result).toEqual({
      text: `In ${projectId} the Initiative follows Full, on its page. Its Short name is ${shortName}, so Confirm makes initiative/${shortName} in ${projectId}. It has no Gate, so it publishes without the user's review; say so to the user.`,
      isError: false,
    });
    expect(await current()).toMatchObject({
      pipelines: [{ projectId, pipelineId: "full" }],
      shortName,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });

  it("drafts a Proposal of another Pipeline once the Initiative is active", async () => {
    await confirmedOn("full");

    const result = await call({ projectId, pipelineId: "quick-fix" });

    expect(result).toEqual({
      text: "The Initiative is active, so this is drafted as a Proposal in this Thread: it changes the Initiative once the user applies it.",
      isError: false,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([
      { sessionId: SESSION, change: proposed("quick-fix") },
    ]);
    expect(pipelineOf(await current())).toBe("full");
  });

  it("drafts nothing for None once the Initiative is active", async () => {
    await confirmedOn("full");

    const result = await call({ projectId, pipelineId: null });

    expect(result).toEqual({
      text: `Whether the Initiative has a Pipeline in The ${projectId} was fixed at Confirm.`,
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
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
