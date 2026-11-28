import type { INestApplication } from "@nestjs/common";
import {
  OFFICE_INSTRUCTIONS_MAX_CHARACTERS,
  SET_OFFICE_INSTRUCTIONS_ACTION,
  SET_SIZE_THRESHOLD_ACTION,
  SET_STAGE_CONTEXT_LIMITS_ACTION,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";
import { OfficeInstructions } from "../../application/office-instructions.js";
import { SessionThreads } from "../../application/session-threads.js";
import { ConversationsSettings } from "../../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepository } from "../../ports/office-instructions-repository.js";
import { OfficeInstructionsRepositoryForTests } from "../../ports/office-instructions-repository.fixtures.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import { ConversationsSettingsOfficeActionsController } from "../http/conversations-settings-office-actions.controller.js";
import { ConversationsSettingsOfficeActions } from "./conversations-settings-office-actions.js";

const APPLICATION = { user: ANN_LEE, proposedBy: "cto" };

let app: INestApplication;
let url: string;
let repository: OfficeInstructionsRepositoryForTests;
/** The user who wrote the newest message of each session's Thread, as Threads give them. */
let askedBy: Map<string, typeof BEN_ITO>;

beforeEach(async () => {
  repository = new OfficeInstructionsRepositoryForTests();
  askedBy = new Map();
  ({ app, url } = await startTestApplication({
    imports: [EventsModule],
    controllers: [ConversationsSettingsOfficeActionsController],
    providers: [
      OfficeToolRegistry,
      ContextPolicySettingsService,
      OfficeInstructions,
      ConversationsSettingsOfficeActions,
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      { provide: OfficeInstructionsRepository, useValue: repository },
      {
        provide: SessionThreads,
        useValue: { askedByInSession: (id: string) => Promise.resolve(askedBy.get(id)) },
      },
    ],
  }));
});

afterEach(async () => {
  await app.close();
});

function toolOf(name: string): OfficeTool {
  const [tool] = app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool;
}

function callTool(name: string, input: Record<string, unknown>, sessionId = "session-1") {
  const tool = toolOf(name);
  return tool.run(tool.input.parse(input), anOfficeToolCall(sessionId));
}

function put(path: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("set_size_threshold", () => {
  it("is carried out by a person's call, in words, and by the route alike", async () => {
    const result = await callTool(SET_SIZE_THRESHOLD_ACTION.name, { sizeThreshold: 150_000 });

    expect(result).toMatchObject({ isError: false });
    expect(result.text).toContain("150000 tokens");
    expect(await app.get(ContextPolicySettingsService).sizeThreshold()).toBe(150_000);
    const routed = await put("/settings/size-threshold", { sizeThreshold: 200_000 });
    expect(routed.status).toBe(200);
    expect(await routed.json()).toEqual({ sizeThreshold: 200_000 });
    expect(await app.get(ContextPolicySettingsService).sizeThreshold()).toBe(200_000);
  });

  it("refuses a threshold off the contract's steps by the route with 400", async () => {
    expect((await put("/settings/size-threshold", { sizeThreshold: 1 })).status).toBe(400);
  });

  it("drafts the threshold beside the one in force, applies it and then reads stale", async () => {
    const tool = toolOf(SET_SIZE_THRESHOLD_ACTION.name);
    const input = tool.input.parse({ sizeThreshold: 150_000 });
    const before = await app.get(ContextPolicySettingsService).sizeThreshold();

    const draft = await tool.draft?.(input);

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "size-threshold" });
    expect(draft?.subject.title).toBe("Size threshold");
    expect(draft?.fields).toMatchObject([{ before: String(before), after: "150000" }]);
    expect(await tool.applyFor?.(input, APPLICATION)).toMatchObject({ isError: false });
    expect(await app.get(ContextPolicySettingsService).sizeThreshold()).toBe(150_000);
    expect((await tool.draft?.(input))?.fingerprint).not.toEqual(draft?.fingerprint);
  });
});

describe("set_stage_context_limits", () => {
  const LIMITS = { soft: 60_000, hard: 120_000 };

  it("is carried out by a person's call, in words, and by the route alike", async () => {
    const result = await callTool(SET_STAGE_CONTEXT_LIMITS_ACTION.name, {
      stageContextLimits: LIMITS,
    });

    expect(result).toMatchObject({ isError: false, text: "The Stage context limits are saved." });
    expect(await app.get(ContextPolicySettingsService).stageContextLimits()).toEqual(LIMITS);
    const other = { soft: 70_000, hard: 130_000 };
    const routed = await put("/settings/stage-context-limits", { stageContextLimits: other });
    expect(routed.status).toBe(200);
    expect(await routed.json()).toEqual({ stageContextLimits: other });
  });

  it("drafts the limits beside those in force, applies them and then reads stale", async () => {
    const tool = toolOf(SET_STAGE_CONTEXT_LIMITS_ACTION.name);
    const input = tool.input.parse({ stageContextLimits: LIMITS });

    const draft = await tool.draft?.(input);

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "stage-context-limits" });
    expect(draft?.subject.title).toBe("Stage context limits");
    expect(draft?.fields.length).toBeGreaterThan(0);
    expect(JSON.stringify(draft?.fields)).toContain("100000");
    expect(await tool.applyFor?.(input, APPLICATION)).toMatchObject({ isError: false });
    expect(await app.get(ContextPolicySettingsService).stageContextLimits()).toEqual(LIMITS);
    expect((await tool.draft?.(input))?.fingerprint).not.toEqual(draft?.fingerprint);
  });
});

describe("set_office_instructions", () => {
  it("is carried out by a person's call for the user who asked, and by the route alike", async () => {
    askedBy.set("session-1", BEN_ITO);

    const result = await callTool(SET_OFFICE_INSTRUCTIONS_ACTION.name, {
      officeInstructions: "Be brief.",
    });

    expect(result).toMatchObject({ isError: false });
    expect((await app.get(OfficeInstructions).current()).text).toBe("Be brief.");
    expect(repository.savedBy.get(1)).toEqual({ userId: BEN_ITO.userId, name: BEN_ITO.name });
    const routed = await put("/settings/office-instructions", {
      officeInstructions: "  Be kind. ",
    });
    expect(routed.status).toBe(200);
    expect(await routed.json()).toEqual({ officeInstructions: "Be kind." });
    expect((await app.get(OfficeInstructions).current()).text).toBe("Be kind.");
  });

  it("says in words when the text is emptied", async () => {
    askedBy.set("session-1", BEN_ITO);

    const result = await callTool(SET_OFFICE_INSTRUCTIONS_ACTION.name, { officeInstructions: "" });

    expect(result.text).toBe("The Office instructions are empty now.");
  });

  it("answers a call from a session with no asking user in words", async () => {
    const result = await callTool(SET_OFFICE_INSTRUCTIONS_ACTION.name, {
      officeInstructions: "Be brief.",
    });

    expect(result).toMatchObject({
      isError: true,
      text: "The Office doesn't know which user asked for this.",
    });
    expect((await app.get(OfficeInstructions).current()).text).toBe("");
  });

  it("refuses a text over the limit by the route with 400", async () => {
    const tooLong = "x".repeat(OFFICE_INSTRUCTIONS_MAX_CHARACTERS + 1);

    expect(
      (await put("/settings/office-instructions", { officeInstructions: tooLong })).status,
    ).toBe(400);
  });

  it("drafts the text beside the one in force and applies it for the user who allowed it", async () => {
    const tool = toolOf(SET_OFFICE_INSTRUCTIONS_ACTION.name);
    const input = tool.input.parse({ officeInstructions: "Be brief." });

    const draft = await tool.draft?.(input);

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "office-instructions" });
    expect(draft?.subject.title).toBe("Office instructions");
    expect(draft?.fields).toMatchObject([{ after: "Be brief." }]);
    expect(await tool.applyFor?.(input, APPLICATION)).toMatchObject({ isError: false });
    expect((await app.get(OfficeInstructions).current()).text).toBe("Be brief.");
    expect(repository.savedBy.get(1)).toEqual({ userId: ANN_LEE.userId, name: ANN_LEE.name });
    expect((await tool.draft?.(input))?.fingerprint).not.toEqual(draft?.fingerprint);
  });
});
