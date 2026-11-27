import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { RequestMethod, type INestApplication } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryModule, DiscoveryService, MetadataScanner } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import {
  EVENTS_PATH,
  OFFICE_ACTIONS,
  WRITE_ROUTE_REGISTER,
  authorityAreaKeySchema,
  type WriteRouteMethod,
} from "@the-office/contracts";
import { WebSocket as WsClient } from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../test/test-application.js";
import { testDatabaseUrl } from "../test/test-database.js";
import { AppModule } from "./app.module.js";
import {
  StageDecisions as ConversationsStageDecisions,
  TaskTokens,
  ThreadService,
} from "./modules/conversations/index.js";
import {
  EngineModule,
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
} from "./modules/engine/index.js";
import { GitHubAccess } from "./modules/github/index.js";
import {
  StageDecisions,
  StageRunsRunningNow,
  TaskCommands,
  TaskGit,
  TaskUsage,
} from "./modules/pipelines/index.js";
import { ownProjectsStartedTasks } from "./modules/pipelines/index.fixtures.js";
import { TaskWorktrees } from "./modules/projects/index.js";
import {
  BrowserConnections,
  HealthReadings,
  SessionsRunning,
  StageRunsRunning,
} from "./modules/telemetry/index.js";
import { ownProjectsQueue } from "./modules/work/index.fixtures.js";
import { OfficeIdentity } from "./platform/git-identity/office-identity.js";
import { GITHUB_SITE } from "./platform/git-identity/github-site.js";
import { SIGN_IN_FIRST } from "./platform/http/signed-in-requests.js";
import { SystemHealthRecorder } from "./platform/system-health/system-health-recorder.js";
import { EventStream } from "./platform/websocket/event-stream.js";

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
      DiscoveryModule,
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

it.each([
  ["Health readings", HealthReadings, SystemHealthRecorder],
  ["sessions running", SessionsRunning, ThreadService],
  ["Stage runs running", StageRunsRunning, StageRunsRunningNow],
  ["browser connections", BrowserConnections, EventStream],
] as const)("binds System health's %s to the one service that knows them", (_, port, service) => {
  const bound: unknown = app.get(port, { strict: false });

  expect(bound).toBe(app.get(service, { strict: false }));
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

const WRITE_METHODS: ReadonlyMap<RequestMethod, WriteRouteMethod> = new Map([
  [RequestMethod.POST, "POST"],
  [RequestMethod.PUT, "PUT"],
  [RequestMethod.PATCH, "PATCH"],
  [RequestMethod.DELETE, "DELETE"],
]);

function declaredPaths(target: object): string[] {
  const declared: unknown = Reflect.getMetadata(PATH_METADATA, target);
  if (Array.isArray(declared)) return declared.map(String);
  return typeof declared === "string" ? [declared] : ["/"];
}

function joinedPath(controllerPath: string, handlerPath: string): string {
  const joined = `/${controllerPath}/${handlerPath}`.replaceAll(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

/**
 * Every write route the controllers declare, as the register writes it, with the handler that
 * declares it: read from Nest's own route metadata, inherited handlers (Office actions') included.
 */
function writeRoutesOf(compiled: INestApplication): { route: string; where: string }[] {
  const scanner = compiled.get(MetadataScanner);
  return compiled
    .get(DiscoveryService)
    .getControllers()
    .flatMap(({ instance, metatype }) => {
      if (metatype === null || metatype === undefined) return [];
      const prototype = Object.getPrototypeOf(instance) as object;
      return declaredPaths(metatype).flatMap((controllerPath) =>
        scanner.getAllMethodNames(prototype).flatMap((name) => {
          const handler = (prototype as Record<string, unknown>)[name];
          if (typeof handler !== "function") return [];
          const method = WRITE_METHODS.get(Reflect.getMetadata(METHOD_METADATA, handler));
          if (method === undefined) return [];
          return declaredPaths(handler).map((handlerPath) => ({
            route: `${method} ${joinedPath(controllerPath, handlerPath)}`,
            where: `${metatype.name}.${name}`,
          }));
        }),
      );
    });
}

it("classifies every write route as an Office action, the user's alone, no action or a known gap", () => {
  const discovered = writeRoutesOf(app);
  const officeActions = new Set<string>(
    OFFICE_ACTIONS.map(({ route }) => `${route.method} ${route.path}`),
  );
  const registered = new Set<string>(
    [
      ...WRITE_ROUTE_REGISTER.usersAlone,
      ...WRITE_ROUTE_REGISTER.noAction,
      ...WRITE_ROUTE_REGISTER.knownGaps,
    ].map(({ route }) => route),
  );
  const found = new Set(discovered.map(({ route }) => route));

  expect(discovered.length).toBeGreaterThan(200);
  expect(
    discovered
      .filter(({ route }) => !officeActions.has(route) && !registered.has(route))
      .map(({ route, where }) => `${route} (${where})`),
    "Make each an Office action, or add it to WRITE_ROUTE_REGISTER (packages/contracts/src/write-routes.ts) with its reason",
  ).toEqual([]);
  expect(
    [...registered].filter((route) => !found.has(route)),
    "No controller declares these any more: remove them from WRITE_ROUTE_REGISTER",
  ).toEqual([]);
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
        { method: "POST", path: "/api/sign-in/set-password" },
        { method: "POST", path: "/api/sign-in/github" },
        { method: "GET", path: "/api/sign-in/github/callback" },
        { method: "POST", path: "/api/sign-in/google" },
        { method: "GET", path: "/api/sign-in/google/callback" },
        { method: "GET", path: "/api/health" },
      ]),
    );
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/api/users" },
        { method: "POST", path: "/api/users" },
        { method: "POST", path: "/api/users/x/one-time-password" },
        { method: "DELETE", path: "/api/users/x" },
        { method: "PATCH", path: "/api/account" },
        { method: "POST", path: "/api/account/password" },
        { method: "PUT", path: "/api/account/appearance" },
        { method: "GET", path: "/api/account/linked-identities" },
        { method: "POST", path: "/api/account/linked-identities/github" },
        { method: "DELETE", path: "/api/account/linked-identities/github" },
        { method: "GET", path: "/api/account/identity-callback-urls/github" },
        { method: "POST", path: "/api/account/linked-identities/google" },
        { method: "DELETE", path: "/api/account/linked-identities/google" },
        { method: "GET", path: "/api/account/identity-callback-urls/google" },
        { method: "GET", path: "/api/settings/google-client" },
        { method: "PUT", path: "/api/settings/google-client" },
        { method: "DELETE", path: "/api/settings/google-client" },
        { method: "GET", path: "/api/first-run-setup" },
        { method: "POST", path: "/api/first-run-setup/close" },
        { method: "GET", path: "/api/settings/telemetry" },
        { method: "PUT", path: "/api/settings/telemetry" },
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

  it("derives a route and an Office tool from every declared Office action, each with its Authority group", () => {
    const routes = routesOf(served);
    const tools = served.get(OfficeToolRegistry, { strict: false });

    for (const { name, route, group } of OFFICE_ACTIONS) {
      expect(routes, `${name} has no route`).toContainEqual({
        method: route.method,
        path: `/api${route.path}`.replaceAll(/:\w+/g, "x"),
      });
      // A module registers an action's tool only from its handler, so no handler, no tool.
      const ruled = tools.actionTools().find((tool) => tool.name === name);
      expect(ruled, `${name} has no Office tool`).toBeDefined();
      expect(ruled?.group).toBe(group);
    }
  });

  it("lists every registered Office tool with its area: an action's own, Core or one of the area's hand-written tools", () => {
    const tools = served.get(OfficeToolRegistry, { strict: false });
    const declared = new Map<string, string>(OFFICE_ACTIONS.map(({ name, area }) => [name, area]));
    const registered = tools.areas();
    const byArea: Record<string, string[]> = {};
    for (const handWritten of registered.filter((tool) => !declared.has(tool.name))) {
      (byArea[handWritten.area] ??= []).push(handWritten.name);
    }

    expect(
      registered.filter(({ name, area }) => declared.has(name) && declared.get(name) !== area),
      "actions whose tool has another area than their declaration",
    ).toEqual([]);
    expect(
      registered.filter(
        ({ area }) => area !== "core" && !authorityAreaKeySchema.safeParse(area).success,
      ),
      "tools of an area the Authority catalog doesn't have",
    ).toEqual([]);
    expect(
      Object.fromEntries(Object.entries(byArea).map(([area, names]) => [area, names.toSorted()])),
    ).toEqual({
      core: [
        "answer_consultation",
        "answer_decision",
        "attach_file",
        "capture_idea",
        "choose_route",
        "consult",
        "list_ideas",
        "list_people",
        "list_pipelines",
        "list_projects",
        "list_prompt_templates",
        "list_source_skills",
        "list_stage_templates",
        "list_tasks",
        "mark_planned",
        "open_decision",
        "propose_bug_task",
        "propose_pipeline",
        "read_attachment",
        "read_idea",
        "read_initiative",
        "read_office_instructions",
        "read_prompt_template",
        "read_repository",
        "read_role",
        "read_skill_update",
        "read_stage_history",
        "read_task",
        "read_threads",
        "remember",
        "run_project_command",
        "start_planning",
        "update_branch",
        "write_bug_details",
        "write_definition_of_done",
        "write_kind",
        "write_plan",
        "write_run_environment_definition",
        "write_tags",
      ],
      initiatives: ["create_initiative"],
      officeSettings: ["post_link_card", "propose_office_setup", "show_office_status"],
      operations: ["run_environment_check"],
      projectsAndSettings: ["change_project_settings", "propose_project"],
      work: ["create_task"],
    });
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
