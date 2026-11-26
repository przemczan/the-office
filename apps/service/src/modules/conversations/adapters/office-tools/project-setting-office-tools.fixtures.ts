import { OfficeToolRegistry, type OfficeTool, type OfficeToolCall } from "../../../engine/index.js";

type OfficeToolUser = NonNullable<OfficeToolCall["allowedBy"]>;
import type { RoleCards } from "../../../people/index.js";
import {
  ProjectRefused,
  RunEnvironmentSwitchRegistry,
  type Action,
  type ProjectActions,
  type ProjectService,
  type SettingChangedBy,
  type TestTarget,
  type TestTargets,
} from "../../../projects/index.js";
import { CHANGE_PROJECT_SETTINGS_TOOL } from "../../domain/session-instructions.js";
import type { Thread } from "../../domain/thread.js";
import { aThread, aUserMessage } from "../../domain/thread.fixtures.js";
import { ANN_LEE } from "../../domain/user.fixtures.js";
import type { ThreadRepository } from "../../ports/thread-repository.js";
import { ProjectSettingOfficeTools } from "./project-setting-office-tools.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

// What the change_project_settings tool's tests share.

export const SESSION = "session-1";
export const TASK = "task-1";
export const SECRET_VALUE = "s3cret-token-value";

/** Who the session's person is, as the change records them. */
export const BY_NINA: SettingChangedBy = {
  kind: "person",
  roleKey: "devops",
  name: "Nina",
  title: "Devops",
  taskId: TASK,
  askedBy: ANN_LEE,
};

type Project = Awaited<ReturnType<ProjectService["read"]>>;

export const SHOP = {
  id: "shop",
  name: "Shop",
  installCommand: "npm ci",
  installInputs: ["package-lock.json"],
  beforePublishingCommand: "",
  afterPublishingCommand: "",
  commands: [
    {
      key: "build",
      name: "Build",
      kind: "build",
      commandLine: "npm run build",
      rerunCommandLine: "",
    },
    { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
  ],
  environment: {
    set: [
      { name: "GREETING", value: "hello", secret: false },
      { name: "API_TOKEN", value: SECRET_VALUE, secret: true },
    ],
    unset: ["NODE_OPTIONS"],
    prependPath: [],
  },
  features: {},
  runEnvironment: "off",
} as unknown as Project;

export const WEB_TARGET: TestTarget = {
  key: "web",
  name: "Web",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "dev", arguments: [] },
  port: 5173,
  portVariable: "PORT",
  variables: [],
  secretVariables: [{ name: "STRIPE_KEY", value: SECRET_VALUE }],
  commandsBefore: ["install"],
  memoryMegabytes: null,
  setBy: {},
};

export const BUILD_ACTION: Action = {
  key: "build-app",
  name: "Build the app",
  kind: "project-command",
  leavesTheWorkstation: false,
  settings: {
    commandKey: "build",
    commandsBefore: [],
    timeLimitMinutes: null,
    projectDeviceId: null,
  },
  setBy: {},
};

export const RELEASE_ACTION: Action = {
  key: "release",
  name: "Release",
  kind: "workflow",
  leavesTheWorkstation: true,
  settings: { file: "release.yml", inputs: {} },
  setBy: {},
};

/** Every change the tool asked of Projects, by method, with what it was given. */
export interface Change {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * The tool as registered, over a Projects that keeps what it was asked, in Nina's session on a
 * Task or in the `thread` given. The ruling of the call is OfficeToolRulings', tested there.
 */
export function toolsWith(
  options: {
    readonly failingActions?: boolean;
    readonly project?: Project;
    readonly thread?: Thread;
  } = {},
) {
  const project = options.project ?? SHOP;
  const changes: Change[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      changes.push({ method, args });
      return Promise.resolve();
    };
  const projects = {
    find: (id: string) => Promise.resolve(id === project.id ? project : undefined),
    read: () => Promise.resolve(project),
    proposedCommandsProblems: () => Promise.resolve([]),
    changeCommandsAsProposed: record("changeCommandsAsProposed"),
    changeEnvironment: record("changeEnvironment"),
  } as unknown as ProjectService;
  const testTargets = {
    list: () => Promise.resolve([WEB_TARGET]),
    change: record("testTargets.change"),
  } as unknown as TestTargets;
  const actions = {
    list: () => Promise.resolve([BUILD_ACTION, RELEASE_ACTION]),
    change: options.failingActions
      ? () =>
          Promise.reject(new ProjectRefused(['Action "lint-all" runs no command the Project has.']))
      : record("actions.change"),
  } as unknown as ProjectActions;
  const runEnvironments = new RunEnvironmentSwitchRegistry();
  runEnvironments.register((projectId, runEnvironment, by) => {
    changes.push({ method: "runEnvironments.change", args: [projectId, runEnvironment, by] });
    return Promise.resolve();
  });
  return {
    ...toolsOn({ projects, testTargets, actions, runEnvironments }, options.thread),
    changes,
  };
}

/** What the tool changes Projects' settings through. */
export interface ProjectSettingServices {
  readonly projects: ProjectService;
  readonly testTargets: TestTargets;
  readonly actions: ProjectActions;
  readonly runEnvironments: RunEnvironmentSwitchRegistry;
}

/** The tool as registered over `services`, in Nina's session on a Task unless `thread` is given. */
export function toolsOn(
  services: ProjectSettingServices,
  thread: Thread = aThread({ roleKey: "devops", home: { kind: "task", taskId: TASK } }),
) {
  const threads = {
    findBySession: (sessionId: string) =>
      Promise.resolve(sessionId === SESSION ? thread : undefined),
    messages: () => Promise.resolve([aUserMessage(thread, "Set up Shop's environment.")]),
  } as unknown as ThreadRepository;
  const roleCards = {
    find: () => Promise.resolve({ card: { name: "Nina", title: "Devops" } }),
  } as unknown as RoleCards;
  const registry = new OfficeToolRegistry();
  new ProjectSettingOfficeTools(
    registry,
    services.projects,
    services.testTargets,
    services.actions,
    services.runEnvironments,
    threads,
    roleCards,
  ).onModuleInit();
  const [tool] = registry.named([CHANGE_PROJECT_SETTINGS_TOOL], RUN_EVERY_CALL);
  if (!tool) throw new Error(`${CHANGE_PROJECT_SETTINGS_TOOL} is not registered.`);
  return { tool };
}

/** The call from `sessionId`, run after `allowedBy`'s Allow once when given. */
function callFrom(sessionId: string, allowedBy?: OfficeToolUser): OfficeToolCall {
  return {
    sessionId,
    outputFolder: "",
    judgeCommand: () => Promise.resolve({ allowed: true }),
    ...(allowedBy ? { allowedBy } : {}),
  };
}

/** Runs the tool on the input as the engine gives it: parsed, its defaults filled. */
export function runOf(
  tool: OfficeTool,
  input: unknown,
  sessionId = SESSION,
  allowedBy?: OfficeToolUser,
) {
  return tool.run(tool.input.parse(input), callFrom(sessionId, allowedBy));
}

/** The tool's own refusal of the call, as the ruling step asks it before it runs or holds one. */
export function checkOf(tool: OfficeTool, input: unknown) {
  return tool.authority?.check?.(tool.input.parse(input), callFrom(SESSION));
}

/** The lines the approval card lists for the call. */
export function approvalLinesOf(tool: OfficeTool, input: unknown) {
  return tool.authority?.approvalLines?.(tool.input.parse(input), callFrom(SESSION));
}
