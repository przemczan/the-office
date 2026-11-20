import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { skillListSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  EngineModels,
  EngineSessions,
  FIRST_CLAUDE_CODE_ENGINE,
  ScriptedEngine,
  ScriptedEngineModule,
  type EngineSession,
  type SessionScript,
} from "../../engine/index.js";
import {
  apiEngineOnFakeServer,
  EngineSettingsForTests,
  textReply,
  type ApiEngineOnFakeServer,
} from "../../engine/index.fixtures.js";
import {
  createProjectCheckout,
  projectSkillMd,
  type ProjectCheckout,
} from "../adapters/git/project-checkout.fixtures.js";
import { SkillUseRepository } from "../ports/skill-use-repository.js";
import { SkillsModule } from "../skills.module.js";
import { ProjectSkills } from "./project-skills.js";
import { RoleSkills } from "./role-skills.js";
import { SessionSkills, type PreparedSkills } from "./session-skills.js";
import { SkillLibrary } from "./skill-library.js";
import { SKILL_USE_PRUNE } from "./skill-uses.js";

type SessionSettings = Parameters<EngineSessions["start"]>[0]["settings"];

let officeData: string;
let checkout: ProjectCheckout;
let api: ApiEngineOnFakeServer;
let claudeCode: ScriptedEngine;
let app: INestApplication;
let url: string;

/** Names of each test's own: every test file shares the database. */
let tdd: string;
let roleKey: string;
let projectId: string;

/** Claude Code's session: a Skill call of a library skill, a subagent's of a Project skill, and an engine's own. */
const claudeCodeSession = (): SessionScript => [
  { step: "start", brief: { id: "brief", text: "Begin." } },
  skillCall("call-1", `office:${tdd}`, undefined),
  skillCall("call-2", "/deploy", "call-task"),
  skillCall("call-3", "init", undefined),
  {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "completed",
      consumedMessageIds: ["brief"],
      usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
      sessionCostUsd: 0,
      output: undefined,
      errors: [],
    },
  },
  { step: "end" },
];

function skillCall(
  callId: string,
  skill: string,
  withinToolCall: string | undefined,
): SessionScript[number] {
  return {
    step: "event",
    event: {
      kind: "tool-call",
      callId,
      tool: "Skill",
      officeTool: false,
      input: { skill },
      withinToolCall,
    },
  };
}

beforeEach(async () => {
  tdd = `tdd-${randomUUID().slice(0, 8)}`;
  roleKey = `role-${randomUUID().slice(0, 8)}`;
  projectId = `project-${randomUUID()}`;
  officeData = await mkdtemp(join(tmpdir(), "office-skill-uses-"));
  checkout = await createProjectCheckout();
  await checkout.write(".claude/skills/deploy/SKILL.md", projectSkillMd("deploy", "Deploys."));
  await checkout.write(".claude/commands/ops/release.md", "Release it.");
  checkout.commit();
  api = await apiEngineOnFakeServer(officeData);
  claudeCode = new ScriptedEngine([claudeCodeSession()]);
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      SkillsModule,
      ScriptedEngineModule.register({
        "agent-sdk": claudeCode,
        "claude-code-p": claudeCode,
        "openai-compatible-api": api.engine,
        codex: new ScriptedEngine([]),
        "copilot-cli": new ScriptedEngine([]),
        "gemini-cli": new ScriptedEngine([]),
      }),
    ],
    overrides: [
      {
        provide: EngineModels,
        useValue: new EngineModels(
          new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, api.endpoint] }),
        ),
      },
    ],
  }));
  const library = app.get(SkillLibrary);
  await library.write({ name: tdd, description: "Test first.", instructions: "Write the test." });
  await library.turnOn(tdd);
  await app.get(RoleSkills).assignToRole(roleKey, [tdd], null);
});

afterEach(async () => {
  await app.get(SkillLibrary).remove(tdd);
  await app.close();
  await api.server.close();
  await checkout.remove();
  await rm(officeData, { recursive: true, force: true });
});

/** Runs a session in the Project on `engine` until its first turn ends, then forgets its skills. */
async function oneTurnInTheProject(engine: Pick<SessionSettings, "engineId" | "model">) {
  const sessionId = randomUUID();
  const skills = await app.get(SessionSkills).prepare({
    sessionId,
    roleKey,
    project: { id: projectId, folder: checkout.path, useProjectSkills: true, projectSkillsOff: [] },
  });
  const session = await app.get(EngineSessions).start({
    id: sessionId,
    settings: settingsOn(engine, skills),
    brief: { id: "brief", text: "Begin." },
  });
  await untilTurnEnds(session);
  await session.end();
  await app.get(SessionSkills).forget(sessionId);
}

function settingsOn(
  engine: Pick<SessionSettings, "engineId" | "model">,
  { folder, names, expected, userOnly, overrides }: PreparedSkills,
): SessionSettings {
  return {
    ...engine,
    folder: checkout.path,
    environment: {},
    effort: "low",
    skills: { folder, names, expected, userOnly, overrides },
    profile: { edit: false, run: { kind: "read-only-git" }, web: false, mcpTools: {} },
    officeTools: [],
    mcpServers: [],
    instructions: "",
    outputSchema: undefined,
    turnLabel: "Jim in a chat",
  };
}

async function untilTurnEnds(session: EngineSession): Promise<void> {
  for await (const event of session.events) if (event.kind === "turn-ended") return;
}

async function libraryUses(): Promise<number | undefined> {
  const listed = skillListSchema.parse(await (await fetch(`${url}/api/skills`)).json());
  return listed.find(({ name }) => name === tdd)?.usesInLast7Days;
}

async function projectUses(): Promise<Record<string, number>> {
  const listed = await app.get(ProjectSkills).of(projectId, checkout.path);
  return Object.fromEntries(listed.map(({ key, usesInLast7Days }) => [key, usesInLast7Days]));
}

describe("Skill uses", () => {
  it("counts a session's Skill calls on Claude Code, a subagent's too, and not an engine's own skill", async () => {
    await oneTurnInTheProject({ engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-haiku-5-5" });

    await expect(libraryUses()).resolves.toBe(1);
    await expect(projectUses()).resolves.toEqual({ deploy: 1, "ops:release": 0 });
  });

  it("counts a session's Skill calls on the OpenAI-compatible API engine", async () => {
    api.server.script(
      {
        kind: "reply",
        toolCalls: [
          { name: "Skill", arguments: [JSON.stringify({ skill: `office:${tdd}` })] },
          { name: "Skill", arguments: [JSON.stringify({ skill: "ops:release" })] },
        ],
      },
      textReply(["Done."]),
    );

    await oneTurnInTheProject({ engineId: api.endpoint.id, model: api.endpoint.defaultModel });

    await expect(libraryUses()).resolves.toBe(1);
    await expect(projectUses()).resolves.toEqual({ deploy: 0, "ops:release": 1 });
  });

  it("prunes the uses older than 7 days once a day", async () => {
    // A year no other file's uses reach, as the prune removes every use up to its time.
    const schedule = app.get(Schedule) as ManualSchedule;
    schedule.setTime(new Date("2002-01-08T12:00:00.000Z"));
    const deploy = { kind: "project", projectId, key: "deploy" } as const;
    const uses = app.get(SkillUseRepository);
    await uses.add({
      sessionId: "s-1",
      skill: deploy,
      usedAt: new Date("2002-01-01T12:00:00.000Z"),
    });
    await uses.add({
      sessionId: "s-1",
      skill: deploy,
      usedAt: new Date("2002-01-01T12:00:01.000Z"),
    });

    await schedule.runDaily(SKILL_USE_PRUNE);

    await expect(uses.projectCounts(projectId, new Date(0))).resolves.toEqual(
      new Map([["deploy", 1]]),
    );
  });
});
