import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EVENTS_PATH } from "@the-office/contracts";
import { WebSocket as WsClient } from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../test/test-application.js";
import { testDatabaseUrl } from "../test/test-database.js";
import { AppModule } from "./app.module.js";
import {
  StageDecisions as ConversationsStageDecisions,
  TaskTokens,
} from "./modules/conversations/index.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "./modules/engine/index.js";
import { GitHubAccess } from "./modules/github/index.js";
import { StageDecisions, TaskCommands, TaskGit, TaskUsage } from "./modules/pipelines/index.js";
import { ownProjectsStartedTasks } from "./modules/pipelines/index.fixtures.js";
import { TaskWorktrees } from "./modules/projects/index.js";
import { ownProjectsQueue } from "./modules/work/index.fixtures.js";
import { OfficeIdentity } from "./platform/git-identity/office-identity.js";
import { GITHUB_SITE } from "./platform/git-identity/github-site.js";
import { SIGN_IN_FIRST } from "./platform/http/signed-in-requests.js";

// Compiled, not started: the composition root's bindings resolve without the engine or listening.
let folder: string;
let app: INestApplication;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-app-module-"));
  const compiled = await Test.createTestingModule({
    imports: [
      AppModule.register(
        {
          host: "127.0.0.1",
          port: 0,
          databaseUrl: testDatabaseUrl(),
          officeDataDirectory: folder,
          gitHub: GITHUB_SITE,
        },
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

/** Express's own list of what it routes: each route's path and methods. */
interface RouterLayer {
  readonly route?: { readonly path: string; readonly methods: Readonly<Record<string, boolean>> };
}

function routesOf(served: INestApplication): { method: string; path: string }[] {
  const express = served.getHttpAdapter().getInstance() as { router: { stack: RouterLayer[] } };
  return express.router.stack.flatMap(({ route }) =>
    route === undefined
      ? []
      : Object.keys(route.methods).map((method) => ({
          method: method.toUpperCase(),
          // Any value stands in for a parameter: the guard answers before the route looks.
          path: route.path.replaceAll(/[:*]\w+/g, "x"),
        })),
  );
}

/** The paths the guard leaves open (spec §2.10). */
function isOpen(path: string): boolean {
  return (
    path === "/api/sign-in" ||
    path.startsWith("/api/sign-in/") ||
    path === "/api/health" ||
    path === "/api/engine/claude-code-p/hook"
  );
}

describe("the whole app, signed out", () => {
  let served: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app: served, port } = await startTestApplication({
      imports: [
        AppModule.register(
          {
            host: "127.0.0.1",
            port: 0,
            databaseUrl: testDatabaseUrl(),
            officeDataDirectory: folder,
            gitHub: GITHUB_SITE,
          },
          { directory: folder, source: "built" },
        ),
      ],
      // Its start releases the queue and takes up runs: none of other files' Tasks.
      overrides: [ownProjectsQueue(), ownProjectsStartedTasks()],
      moduleOverrides: [
        { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
      ],
      requestAccess: "guarded",
    }));
  }, 30_000);

  afterAll(async () => {
    await served.close();
  });

  // node:http, since fetch does not let a test choose the Host header.
  function answerTo(method: string, path: string): Promise<{ status: number; message: unknown }> {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        { host: "127.0.0.1", port, method, path, headers: { host: `localhost:${port}` } },
        (incoming) => {
          let text = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => (text += chunk));
          incoming.on("end", () => {
            const body: unknown = text.startsWith("{") ? JSON.parse(text) : undefined;
            resolve({
              status: incoming.statusCode ?? 0,
              message:
                typeof body === "object" && body !== null && "message" in body
                  ? body.message
                  : undefined,
            });
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  it("answers every /api route 401 from localhost but the sign-in pages, health and the -p hook", async () => {
    const routes = routesOf(served);
    expect(routes.length).toBeGreaterThan(100);
    // The scripted engine stands in for the engine module, whose -p hook route it leaves out.
    expect(routes.filter(({ path }) => isOpen(path))).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/api/sign-in" },
        { method: "POST", path: "/api/sign-in/first-user" },
        { method: "POST", path: "/api/sign-in/password" },
        { method: "GET", path: "/api/health" },
      ]),
    );

    const answered: { route: string; signInFirst: boolean }[] = [];
    for (const { method, path } of routes) {
      const answer = await answerTo(method, path);
      answered.push({
        route: `${method} ${path}`,
        signInFirst: answer.status === 401 && answer.message === SIGN_IN_FIRST,
      });
    }
    expect(answered).toEqual(
      routes.map(({ method, path }) => ({
        route: `${method} ${path}`,
        signInFirst: !isOpen(path),
      })),
    );
  });

  it("refuses the event stream's WebSocket on localhost", async () => {
    const client = new WsClient(`ws://localhost:${port}${EVENTS_PATH}`);

    const refusedWith = await new Promise((resolve) => {
      client.on("unexpected-response", (_request, response) => resolve(response.statusCode));
      client.on("open", () => resolve("open"));
    });

    expect(refusedWith).toBe(401);
  });
});
