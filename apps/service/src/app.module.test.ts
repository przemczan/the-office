import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/test-database.js";
import { AppModule } from "./app.module.js";
import { StageDecisions as ConversationsStageDecisions } from "./modules/conversations/index.js";
import { StageDecisions, TaskCommands, TaskGit } from "./modules/pipelines/index.js";
import { TaskWorktrees } from "./modules/projects/index.js";

// Compiled, not started: the composition root's bindings resolve without the engine or listening.
let folder: string;
let app: INestApplication;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-app-module-"));
  const compiled = await Test.createTestingModule({
    imports: [
      AppModule.register(
        { port: 0, databaseUrl: testDatabaseUrl(), officeDataDirectory: folder },
        { directory: folder, source: "built" },
      ),
    ],
  }).compile();
  // An application, so closing it finds the HTTP server the event stream lets go of.
  app = compiled.createNestApplication();
});

afterAll(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

it.each([
  ["git", TaskGit],
  ["commands", TaskCommands],
])("binds Pipelines' Task %s to the Tasks' worktrees of the one Projects module", (_, port) => {
  const bound: unknown = app.get(port, { strict: false });

  expect(bound).toBeInstanceOf(TaskWorktrees);
  expect(bound).toBe(app.get(TaskWorktrees, { strict: false }));
});

it("binds Pipelines' Stage Decisions to Conversations' one service", () => {
  const bound: unknown = app.get(StageDecisions, { strict: false });

  expect(bound).toBeInstanceOf(ConversationsStageDecisions);
  expect(bound).toBe(app.get(ConversationsStageDecisions, { strict: false }));
});
