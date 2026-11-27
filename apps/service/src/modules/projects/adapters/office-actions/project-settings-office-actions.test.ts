import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  baseBranchFetchSchema,
  CHANGE_DEFAULT_PIPELINE_ACTION,
  CHANGE_KIND_DEFAULT_PIPELINE_ACTION,
  CHANGE_PROJECT_ENGINE_ACTION,
  CHANGE_PROJECT_FEATURES_ACTION,
  CHANGE_PROJECT_LIMIT_ACTION,
  CHANGE_PROJECT_MARK_ACTION,
  CHANGE_PROJECT_SKILL_USE_ACTION,
  CHANGE_SERVER_VALUES_ACTION,
  CHANGE_USE_PROJECT_SKILLS_ACTION,
  CLOSE_PULL_REQUEST_ACTION,
  FETCH_BASE_BRANCH_ACTION,
  IMPORT_ISSUES_ACTION,
  projectMcpServerValuesSchema,
  projectRefusalSchema,
  projectSchema,
  PROJECT_OFFICE_ACTIONS,
  pullRequestRefusalSchema,
  REMOVE_PROJECT_IMAGE_ACTION,
  runEnvironmentSetUpAnswerSchema,
  SET_UP_RUN_ENVIRONMENT_ACTION,
  type OfficeAction,
  type Project as ProjectResponse,
  type RunEnvironmentSetUpAnswer,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { McpServerLibrary, ProjectServerValues } from "../../../mcp-servers/index.js";
import { CiRunWatch } from "../../application/ci-run-watch.js";
import { IssueImport } from "../../application/issue-import.js";
import { ProjectFeatures } from "../../application/project-features.js";
import { ProjectImages } from "../../application/project-images.js";
import { ProjectIssueHosts } from "../../application/project-issue-hosts.js";
import { ProjectService } from "../../application/project-service.js";
import { PullRequestActions } from "../../application/pull-request-actions.js";
import { RepositoryFiles } from "../../application/repository-files.js";
import { WorkflowStarts } from "../../application/workflow-starts.js";
import { RunEnvironmentSetUpRegistry } from "../../application/run-environment-set-up-registry.js";
import { SessionPeople } from "../../application/session-people.js";
import { byTheUser, type ActedBy } from "../../domain/acted-by.js";
import { PullRequestNotFound, PullRequestRefused } from "../../domain/pull-request-refused.js";
import { TestInstanceRefused } from "../../domain/test-instance-refused.js";
import { openedPullRequest, type PullRequest } from "../../domain/pull-request.js";
import { ProjectRepository } from "../../ports/project-repository.js";
import { PullRequestRepository } from "../../ports/pull-request-repository.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { ProjectOfficeActionsController } from "../http/project-office-actions.controller.js";
import { ProjectOfficeActions } from "./project-office-actions.js";

const USER: SignedInUser = { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name };

const STAGE_TASK_ID = randomUUID();

/** The developer on their Task's Agent Stage, which no user asked, their call held and allowed. */
const DEVELOPER_IN_A_STAGE: ActedBy = {
  kind: "person",
  roleKey: "developer",
  taskId: STAGE_TASK_ID,
  allowedBy: USER,
};

const ALLOWED_STAGE_CALL = { ...anOfficeToolCall("stage-session"), allowedBy: USER };

/** Projects' people in sessions: the developer keeps "stage-session" on their Task, nobody any other. */
function givePeopleInSessions(app: INestApplication): void {
  app.get(SessionPeople).provide({
    personInSession: async (sessionId) => (sessionId === "stage-session" ? "developer" : undefined),
    taskInSession: async (sessionId) => (sessionId === "stage-session" ? STAGE_TASK_ID : undefined),
    askedByInSession: async () => undefined,
  });
}

describe("the Office actions of Projects", () => {
  it("declares each action once, with a route no other action has", () => {
    const routes = PROJECT_OFFICE_ACTIONS.map(
      ({ route }) => `${route.method} ${route.path.replaceAll(/:\w+/g, ":")}`,
    );

    expect(new Set(routes).size).toBe(PROJECT_OFFICE_ACTIONS.length);
    expect(new Set(PROJECT_OFFICE_ACTIONS.map(({ name }) => name)).size).toBe(
      PROJECT_OFFICE_ACTIONS.length,
    );
  });
});

async function addMcpServer(app: INestApplication): Promise<string> {
  const name = `github-${randomUUID().slice(0, 8)}`;
  await app.get(McpServerLibrary).add({
    name,
    connection: { transport: "stdio", command: "npx", arguments: ["server-github"] },
    serverValues: [
      { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValue: "office-secret" },
      { name: "GITHUB_HOST", secret: false, required: false, officeWideValue: "github.com" },
    ],
  });
  return name;
}

async function valuesOf(url: string, projectId: string, serverName: string) {
  const listed = await fetch(`${url}/api/projects/${projectId}/server-values`);
  return projectMcpServerValuesSchema
    .array()
    .parse(await listed.json())
    .find((each) => each.serverName === serverName);
}

describe("the settings and upkeep actions on the Projects module", () => {
  let repository: TemporaryRepository;
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    repository = await createTemporaryRepository();
  });

  afterAll(async () => {
    await repository.remove();
  });

  beforeEach(async () => {
    ({ app, url } = await startProjectsApplication(repository));
  });

  afterEach(async () => {
    await app.close();
  });

  const { send, addProject } = projectsHttp(() => ({ app, url, published: [], repository }));

  function toolOf(action: OfficeAction) {
    const [tool] = app.get(OfficeToolRegistry).named([action.name], RUN_EVERY_CALL);
    if (!tool) throw new Error(`No Office tool ${action.name}.`);
    return tool;
  }

  async function projectOf(id: string): Promise<ProjectResponse> {
    return projectSchema.parse(await (await fetch(`${url}/api/projects/${id}`)).json());
  }

  interface ProjectChange {
    readonly action: OfficeAction;
    readonly method: "PUT" | "DELETE";
    readonly path: string;
    readonly body?: Record<string, unknown>;
    /** What the Agent gives besides the Project, where the route's path holds some of it. */
    readonly toolInput?: Record<string, unknown>;
    readonly words: (project: ProjectResponse) => string;
    readonly changed: (project: ProjectResponse) => unknown;
    readonly expected: unknown;
  }

  const CHANGES: readonly ProjectChange[] = [
    {
      action: CHANGE_PROJECT_LIMIT_ACTION,
      method: "PUT",
      path: "project-limit",
      body: { projectLimit: 3 },
      words: ({ name }) => `"${name}" starts at most 3 Tasks at once now.`,
      changed: ({ projectLimit }) => projectLimit,
      expected: 3,
    },
    {
      action: CHANGE_PROJECT_MARK_ACTION,
      method: "PUT",
      path: "mark",
      body: { mark: { label: "ZZ", colour: "teal" } },
      words: ({ name }) => `"${name}" has the mark ZZ in teal now.`,
      changed: ({ mark }) => mark,
      expected: { label: "ZZ", colour: "teal" },
    },
    {
      action: CHANGE_PROJECT_FEATURES_ACTION,
      method: "PUT",
      path: "features",
      body: { features: { "github-issues": false } },
      words: ({ name }) => `The features of "${name}" are changed as given.`,
      changed: ({ features }) => features["github-issues"],
      expected: false,
    },
    {
      action: CHANGE_USE_PROJECT_SKILLS_ACTION,
      method: "PUT",
      path: "use-project-skills",
      body: { useProjectSkills: false },
      words: ({ name }) =>
        `Agents working on "${name}" don't use the skills of its repository now.`,
      changed: ({ useProjectSkills }) => useProjectSkills,
      expected: false,
    },
    {
      action: CHANGE_PROJECT_SKILL_USE_ACTION,
      method: "PUT",
      path: "skill-use",
      body: { key: "review", use: false },
      words: ({ name }) => `The skill review of "${name}" is off now.`,
      changed: ({ projectSkillsOff }) => projectSkillsOff,
      expected: ["review"],
    },
    {
      action: CHANGE_DEFAULT_PIPELINE_ACTION,
      method: "PUT",
      path: "default-pipeline",
      body: { defaultPipeline: "quick-fix" },
      words: ({ name }) => `New Tasks of "${name}" follow the Pipeline quick-fix by default now.`,
      changed: ({ defaultPipeline }) => defaultPipeline,
      expected: "quick-fix",
    },
    {
      action: CHANGE_KIND_DEFAULT_PIPELINE_ACTION,
      method: "PUT",
      path: "kind-default-pipeline",
      body: { kind: "bug", pipelineId: "quick-fix" },
      words: ({ name }) => `New bug Tasks of "${name}" follow the Pipeline quick-fix now.`,
      changed: ({ kindDefaultPipelines }) => kindDefaultPipelines.bug,
      expected: "quick-fix",
    },
    {
      action: CHANGE_PROJECT_ENGINE_ACTION,
      method: "PUT",
      path: "engine",
      body: {},
      words: ({ name }) => `The Engine levels of "${name}" are changed as given.`,
      changed: ({ id }) => typeof id,
      expected: "string",
    },
    {
      action: REMOVE_PROJECT_IMAGE_ACTION,
      method: "DELETE",
      path: "images/icon/light",
      toolInput: { image: "icon", palette: "light" },
      words: ({ name }) => `The light icon of "${name}" is removed.`,
      changed: ({ id }) => typeof id,
      expected: "string",
    },
  ];

  describe.each(CHANGES)("$action.name", (change) => {
    const { action, method, path, body = {}, toolInput = body, words, changed, expected } = change;

    it("answers its route with the Project as the API shows it", async () => {
      const project = await addProject();

      const response = await send(method, `/projects/${project.id}/${path}`, body);

      expect(response.status).toBe(200);
      const answered = projectSchema.parse(await response.json());
      expect(changed(answered)).toEqual(expected);
      expect(answered).toEqual(await projectOf(project.id));
    });

    it("answers the Agent in plain words, after the same change", async () => {
      const project = await addProject();

      const answer = await toolOf(action).run(
        { ...toolInput, projectId: project.id },
        anOfficeToolCall("s-1"),
      );

      expect(answer).toEqual({ isError: false, text: words(project) });
      expect(changed(await projectOf(project.id))).toEqual(expected);
    });

    it("refuses a Project there is none of, as the Project routes do", async () => {
      const response = await send(method, `/projects/${randomUUID()}/${path}`, body);

      expect(response.status).toBe(404);
    });

    it("shows a Proposal the Project it changes", async () => {
      const project = await addProject();

      const draft = await toolOf(action).draft?.({ ...toolInput, projectId: project.id });

      expect(draft?.subject).toEqual({ kind: "project", id: project.id, title: project.name });
    });
  });

  it("shows a Proposal the field a change gives, before and after", async () => {
    const project = await addProject();

    const draft = await toolOf(CHANGE_PROJECT_LIMIT_ACTION).draft?.({
      projectId: project.id,
      projectLimit: 3,
    });

    expect(draft?.fields).toEqual([
      { label: "Project limit", before: String(project.projectLimit), after: "3", form: "short" },
    ]);
  });

  it("refuses in the words of Projects, to the route and to the Agent", async () => {
    const project = await addProject();
    const input = { kind: "bug", pipelineId: "no-such-pipeline" };

    const response = await send("PUT", `/projects/${project.id}/kind-default-pipeline`, input);
    const answer = await toolOf(CHANGE_KIND_DEFAULT_PIPELINE_ACTION).run(
      { ...input, projectId: project.id },
      anOfficeToolCall("s-1"),
    );

    expect(response.status).toBe(422);
    const { reasons } = projectRefusalSchema.parse(await response.json());
    expect(answer).toEqual({ isError: true, text: reasons.join(" ") });
  });

  describe("fetch_base_branch", () => {
    it("answers its route with the base branch's last commit", async () => {
      const project = await addProject();

      const response = await send("POST", `/projects/${project.id}/base-branch/fetch`);

      expect(response.status).toBe(200);
      const fetched = baseBranchFetchSchema.parse(await response.json());
      expect(fetched.fetchProblem).toBeNull();
      expect(fetched.commit).toMatch(/^[0-9a-f]{40}$/);
    });

    it("answers the Agent with the commit", async () => {
      const project = await addProject();

      const answer = await toolOf(FETCH_BASE_BRANCH_ACTION).run(
        { projectId: project.id },
        anOfficeToolCall("s-1"),
      );

      expect(answer).toEqual({
        isError: false,
        text: expect.stringMatching(
          /^The base branch is fetched; its last commit is [0-9a-f]{40}\.$/,
        ),
      });
    });
  });

  describe("import_issues", () => {
    it("is refused by its route in the user's words for a repository on no code host", async () => {
      const project = await addProject();

      const response = await send("POST", `/projects/${project.id}/issues/import`, {
        numbers: [1],
      });

      expect(response.status).toBe(422);
    });

    it("is refused to an Agent in a session nobody keeps, importing nothing", async () => {
      givePeopleInSessions(app);
      const importByHand = vi.spyOn(app.get(IssueImport), "importByHand");
      const project = await addProject();

      const answer = await toolOf(IMPORT_ISSUES_ACTION).run(
        { projectId: project.id, numbers: [1] },
        anOfficeToolCall("nobody's-session"),
      );

      expect(answer).toEqual({
        isError: true,
        text: "The Office doesn't know whose session this is.",
      });
      expect(importByHand).not.toHaveBeenCalled();
    });

    it("imports as the person in an Agent Stage no user asked, with who allowed the call", async () => {
      givePeopleInSessions(app);
      const importByHand = vi.spyOn(app.get(IssueImport), "importByHand");
      const project = await addProject();

      const answer = await toolOf(IMPORT_ISSUES_ACTION).run(
        { projectId: project.id, numbers: [1] },
        ALLOWED_STAGE_CALL,
      );

      // The repository is on no code host, so the import is refused past who asked it.
      expect(answer.isError).toBe(true);
      expect(importByHand).toHaveBeenCalledWith(project.id, [1], DEVELOPER_IN_A_STAGE);
    });
  });

  describe("set_up_run_environment", () => {
    const answer: RunEnvironmentSetUpAnswer = {
      runEnvironment: {
        runEnvironment: "on",
        definition: { state: "valid" },
        setUpProblems: [],
        setUpTask: null,
      },
      start: null,
    };
    let askedBy: ActedBy[];

    beforeEach(() => {
      askedBy = [];
      app.get(RunEnvironmentSetUpRegistry).register(async (_projectId, by) => {
        askedBy.push(by);
        return answer;
      });
    });

    it("answers its route 201 with the set-up's answer, for the signed-in user", async () => {
      const project = await addProject();

      const response = await send("POST", `/projects/${project.id}/run-environment/set-up`);

      expect(response.status).toBe(201);
      expect(runEnvironmentSetUpAnswerSchema.parse(await response.json())).toEqual(answer);
      expect(askedBy).toEqual([byTheUser(USER)]);
    });

    it("answers the Agent in plain words, set up as the person in an Agent Stage no user asked", async () => {
      givePeopleInSessions(app);
      const project = await addProject();

      const result = await toolOf(SET_UP_RUN_ENVIRONMENT_ACTION).run(
        { projectId: project.id },
        ALLOWED_STAGE_CALL,
      );

      expect(result).toEqual({ isError: false, text: "The run environment is on now." });
      expect(askedBy).toEqual([DEVELOPER_IN_A_STAGE]);
    });
  });

  describe("change_server_values", () => {
    const SECRET = "agent-typed-secret";

    it("lets the user's route set a secret's value and never sends it back", async () => {
      const project = await addProject();
      const serverName = await addMcpServer(app);

      const response = await send("PUT", `/projects/${project.id}/server-values/${serverName}`, {
        serverValues: [{ name: "GITHUB_TOKEN", projectValue: SECRET }],
      });

      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(SECRET);
      expect((await valuesOf(url, project.id, serverName))?.serverValues[0]?.projectValueSet).toBe(
        true,
      );
    });

    it("lets an Agent set a plain value", async () => {
      const project = await addProject();
      const serverName = await addMcpServer(app);

      const answer = await toolOf(CHANGE_SERVER_VALUES_ACTION).run(
        {
          projectId: project.id,
          serverName,
          serverValues: [{ name: "GITHUB_HOST", projectValue: "github.example.com" }],
        },
        anOfficeToolCall("s-1"),
      );

      expect(answer).toEqual({
        isError: false,
        text: `The Server values of ${serverName} are changed as given.`,
      });
      expect((await valuesOf(url, project.id, serverName))?.serverValues[1]).toMatchObject({
        projectValue: "github.example.com",
      });
    });

    it("refuses an Agent a value for a secret, saving nothing, and rules the call out up front", async () => {
      const project = await addProject();
      const serverName = await addMcpServer(app);
      const input = {
        projectId: project.id,
        serverName,
        serverValues: [
          { name: "GITHUB_HOST", projectValue: "github.example.com" },
          { name: "GITHUB_TOKEN", projectValue: SECRET },
        ],
      };
      const tool = toolOf(CHANGE_SERVER_VALUES_ACTION);

      const answer = await tool.run(input, anOfficeToolCall("s-1"));
      const upFront = await tool.authority?.check?.(input, anOfficeToolCall("s-1"));

      const refusal = `GITHUB_TOKEN of ${serverName} is a secret: a secret's value is the user's to set, on the Project page.`;
      expect(answer).toEqual({ isError: true, text: refusal });
      expect(upFront).toBe(refusal);
      expect(JSON.stringify(answer)).not.toContain(SECRET);
      expect((await valuesOf(url, project.id, serverName))?.serverValues).toEqual([
        expect.objectContaining({ name: "GITHUB_TOKEN", projectValueSet: false }),
        expect.objectContaining({ name: "GITHUB_HOST", projectValueSet: false }),
      ]);
    });

    it("lets an Agent keep or clear a secret, as no value of it is given", async () => {
      const project = await addProject();
      const serverName = await addMcpServer(app);

      const answer = await toolOf(CHANGE_SERVER_VALUES_ACTION).run(
        { projectId: project.id, serverName, serverValues: [{ name: "GITHUB_TOKEN" }] },
        anOfficeToolCall("s-1"),
      );

      expect(answer.isError).toBe(false);
    });

    it("refuses a server the library hasn't, in the words of the library", async () => {
      const project = await addProject();

      const answer = await toolOf(CHANGE_SERVER_VALUES_ACTION).run(
        { projectId: project.id, serverName: "nothing", serverValues: [] },
        anOfficeToolCall("s-1"),
      );

      expect(answer.isError).toBe(true);
    });
  });
});

const PULL_REQUEST: PullRequest = openedPullRequest({
  id: randomUUID(),
  projectId: "admin-panel",
  taskId: randomUUID(),
  remoteUrl: "https://github.com/office/tools.git",
  number: 7,
  url: "https://github.com/office/tools/pull/7",
  title: "Rename a device",
  branch: "office/task",
  baseBranch: "main",
  openedAt: new Date("2026-11-19T09:00:00.000Z"),
});

const UNUSED = [
  ProjectRepository,
  CiRunWatch,
  WorkflowStarts,
  ProjectService,
  ProjectFeatures,
  ProjectImages,
  ProjectIssueHosts,
  IssueImport,
  RepositoryFiles,
  ProjectServerValues,
  RunEnvironmentSetUpRegistry,
];

describe("close_pull_request", () => {
  let app: INestApplication;
  let url: string;
  let closed: unknown[][];
  let refusal: Error | undefined;

  beforeAll(async () => {
    ({ app, url } = await startTestApplication({
      controllers: [ProjectOfficeActionsController],
      providers: [
        // What the other Office actions of Projects carry out with isn't used by these tests.
        ...UNUSED.map((provide) => ({ provide, useValue: {} })),
        OfficeToolRegistry,
        SessionPeople,
        ProjectOfficeActions,
        {
          provide: PullRequestActions,
          useValue: {
            close: (id: string, by: ActedBy): Promise<void> => {
              closed.push(["close", id, by]);
              return refusal ? Promise.reject(refusal) : Promise.resolve();
            },
          },
        },
        {
          provide: PullRequestRepository,
          useValue: {
            findById: (id: string): Promise<PullRequest | undefined> =>
              Promise.resolve(id === PULL_REQUEST.id ? PULL_REQUEST : undefined),
          },
        },
      ],
    }));
    givePeopleInSessions(app);
  });

  beforeEach(() => {
    closed = [];
    refusal = undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  function close(id = PULL_REQUEST.id): Promise<Response> {
    return fetch(`${url}/api/pull-requests/${id}/close`, { method: "POST" });
  }

  function tool() {
    const [found] = app
      .get(OfficeToolRegistry)
      .named([CLOSE_PULL_REQUEST_ACTION.name], RUN_EVERY_CALL);
    if (!found) throw new Error("No Office tool close_pull_request.");
    return found;
  }

  it("answers its route 204, closing it as the signed-in user", async () => {
    const response = await close();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(closed).toEqual([["close", PULL_REQUEST.id, byTheUser(USER)]]);
  });

  it("answers a refusal 409 with why and whether to refresh", async () => {
    refusal = new PullRequestRefused("Pull request #7 is already merged.", true);

    const response = await close();

    expect(response.status).toBe(409);
    expect(pullRequestRefusalSchema.parse(await response.json())).toEqual({
      reason: "Pull request #7 is already merged.",
      refresh: true,
    });
  });

  it("answers a test instance's refusal 409 the same way, with nothing to refresh", async () => {
    refusal = new TestInstanceRefused("close-pull-request");

    const response = await close();

    expect(response.status).toBe(409);
    expect(pullRequestRefusalSchema.parse(await response.json())).toEqual({
      reason: "A test instance of The Office (OFFICE_TEST_INSTANCE) doesn't close pull requests.",
      refresh: false,
    });
  });

  it("answers a pull request not kept 404", async () => {
    refusal = new PullRequestNotFound(PULL_REQUEST.id);

    const response = await close();

    expect(response.status).toBe(404);
  });

  it("answers the Agent in plain words, closed as the person in an Agent Stage no user asked", async () => {
    const answer = await tool().run({ pullRequestId: PULL_REQUEST.id }, ALLOWED_STAGE_CALL);

    expect(answer).toEqual({
      isError: false,
      text: 'Pull request #7 "Rename a device" is closed, not merged.',
    });
    expect(closed).toEqual([["close", PULL_REQUEST.id, DEVELOPER_IN_A_STAGE]]);
  });

  it("answers the Agent a refusal as an error in the refusal's words", async () => {
    refusal = new PullRequestRefused("Pull request #7 is already merged.", true);

    const answer = await tool().run({ pullRequestId: PULL_REQUEST.id }, ALLOWED_STAGE_CALL);

    expect(answer).toEqual({ isError: true, text: "Pull request #7 is already merged." });
  });

  it("shows a Proposal the pull request it closes", async () => {
    const draft = await tool().draft?.({ pullRequestId: PULL_REQUEST.id });

    expect(draft?.subject).toEqual({
      kind: "pull-request",
      id: PULL_REQUEST.id,
      title: "Pull request #7: Rename a device",
    });
  });
});
