import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../test/test-database.js";
import { AppModule } from "./app.module.js";
import {
  StageDecisions as ConversationsStageDecisions,
  TaskTokens,
} from "./modules/conversations/index.js";
import { GitHubAccess } from "./modules/github/index.js";
import { StageDecisions, TaskCommands, TaskGit, TaskUsage } from "./modules/pipelines/index.js";
import { TaskWorktrees } from "./modules/projects/index.js";
import { OfficeIdentity } from "./platform/git-identity/office-identity.js";

// Compiled, not started: the composition root's bindings resolve without the engine or listening.
let folder: string;
let app: INestApplication;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-app-module-"));
  const compiled = await Test.createTestingModule({
    imports: [
      AppModule.register(
        { host: "127.0.0.1", port: 0, databaseUrl: testDatabaseUrl(), officeDataDirectory: folder },
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

it("binds Pipelines' Task usage to Conversations' Task tokens", () => {
  const bound: unknown = app.get(TaskUsage, { strict: false });

  expect(bound).toBeInstanceOf(TaskTokens);
  expect(bound).toBe(app.get(TaskTokens, { strict: false }));
});

it("binds Pipelines' Stage Decisions to Conversations' one service", () => {
  const bound: unknown = app.get(StageDecisions, { strict: false });

  expect(bound).toBeInstanceOf(ConversationsStageDecisions);
  expect(bound).toBe(app.get(ConversationsStageDecisions, { strict: false }));
});

it("binds the Office identity's GitHub user token to the one GitHub module's access", async () => {
  const access = app.get(GitHubAccess, { strict: false });
  vi.spyOn(access, "isSignedIn").mockResolvedValue(true);

  const needs = await app.get(OfficeIdentity, { strict: false }).needsOf("https://github.com/a/b");

  expect(needs).toEqual({ kind: "github-https", missing: [] });
});
