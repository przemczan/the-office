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
import { THE_USER } from "../../domain/author.js";
import type { Initiative } from "../../domain/initiative.js";
import {
  KnownProjectsForTests,
  ProposalDraftsForTests,
  SessionInitiativesForTests,
} from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { SHAPING_OFFICE_TOOLS } from "../conversations/initiative-thread-records.js";
import { CHOOSE_PIPELINE } from "./shaping-office-tools.js";

let officeData: string;
let work: WorkApplication;
/** The shaping session's Initiative, under a title of its own: Short names are Office-wide. */
let initiative: Initiative;
let shortName: string;

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
    .capture({ title: shortName, notes: "", projectId: undefined }, THE_USER);
  initiative = await work.app.get(InitiativeService).shape(idea.id, THE_USER);
  await work.app
    .get(InitiativeService)
    .addTask(
      initiative.id,
      { title: "Queue writes", projectId: `project-${randomUUID()}`, priority: "normal" },
      [],
      THE_USER,
    );
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
  await work.app.get(InitiativeService).choosePipeline(initiative.id, pipelineId, "straight");
  await work.app.get(InitiativeService).confirm(initiative.id);
}

function proposed(pipelineId: string | null) {
  return {
    kind: "initiative",
    initiativeId: initiative.id,
    edit: { kind: "pipeline", pipelineId },
  } as const;
}

describe("choose_pipeline", () => {
  it("is among a shaping session's Office tools", () => {
    expect(SHAPING_OFFICE_TOOLS).toContain(CHOOSE_PIPELINE);
  });

  it("sets the Initiative's Pipeline straight onto it while shaping, naming its Short name and that it has no Gate", async () => {
    const result = await call({ pipelineId: "full" });

    expect(result).toEqual({
      text: `The Initiative follows Full, on its page. Its Short name is ${shortName}, so Confirm makes initiative/${shortName} in each Project it spans. It has no Gate, so it publishes without the user's review; say so to the user.`,
      isError: false,
    });
    expect(await current()).toMatchObject({ pipelineId: "full", shortName });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });

  it("drafts a Proposal of another Pipeline once the Initiative is active", async () => {
    await confirmedOn("full");

    const result = await call({ pipelineId: "quick-fix" });

    expect(result).toEqual({
      text: "The Initiative is active, so this is drafted as a Proposal in this Thread: it changes the Initiative once the user applies it.",
      isError: false,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([
      { sessionId: SESSION, change: proposed("quick-fix") },
    ]);
    expect((await current()).pipelineId).toBe("full");
  });

  it("drafts nothing for None once the Initiative is active", async () => {
    await confirmedOn("full");

    const result = await call({ pipelineId: null });

    expect(result).toEqual({
      text: "Whether the Initiative has a Pipeline was fixed at Confirm.",
      isError: true,
    });
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });
});

describe("a Proposal of another Pipeline", () => {
  it("changes the Initiative's Pipeline when the user applies it, keeping its Short name", async () => {
    await confirmedOn("full");
    const appliers = work.app.get(ProposalAppliers);

    expect(await appliers.problemsWith(proposed("quick-fix"))).toEqual([]);
    await appliers.apply(proposed("quick-fix"), "cto");

    expect(await current()).toMatchObject({ pipelineId: "quick-fix", shortName });
  });

  it("is refused for an Initiative confirmed with None", async () => {
    await confirmedOn(null);
    const appliers = work.app.get(ProposalAppliers);

    expect(await appliers.problemsWith(proposed("full"))).toEqual([
      "Whether the Initiative has a Pipeline was fixed at Confirm.",
    ]);
    await expect(appliers.apply(proposed("full"), "cto")).rejects.toThrow(ProposalRefused);
  });

  it("is refused when a Project the Initiative spans lacks a command the Pipeline runs", async () => {
    await confirmedOn("full");
    const [projectId] = (await work.app.get(InitiativeService).record(initiative.id)).tasks.map(
      (task) => task.projectId,
    );
    work.app.get(KnownProjectsForTests).commands.set(projectId ?? "", []);
    const appliers = work.app.get(ProposalAppliers);

    expect(await appliers.problemsWith(proposed("quick-fix"))).toEqual([
      `The Pipeline Quick fix runs test, which The ${projectId} has no command for. Add it on the Project page, or choose another Pipeline.`,
    ]);
    await expect(appliers.apply(proposed("quick-fix"), "cto")).rejects.toThrow(ProposalRefused);
  });
});

describe("a Proposal of a Task in a Project the Initiative doesn't span yet", () => {
  it("is refused when that Project lacks a command the Initiative's Pipeline runs", async () => {
    await confirmedOn("full");
    const projectId = `project-${randomUUID()}`;
    work.app.get(KnownProjectsForTests).commands.set(projectId, []);

    expect(
      await work.app.get(ProposalAppliers).problemsWith({
        kind: "initiative",
        initiativeId: initiative.id,
        edit: {
          kind: "add-task",
          title: "Export",
          projectId,
          priority: "normal",
          blockedBy: [],
          taskId: undefined,
        },
      }),
    ).toEqual([
      `The Pipeline Full runs test, which The ${projectId} has no command for. Add it on the Project page, or choose another Pipeline.`,
    ]);
  });
});
