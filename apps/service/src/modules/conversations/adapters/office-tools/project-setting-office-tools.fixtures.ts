import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
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
import type { HeldCallOutcome, HeldCallRequest, HeldCalls } from "../../application/held-calls.js";
import { CHANGE_PROJECT_SETTINGS_TOOL } from "../../domain/session-instructions.js";
import { aThread } from "../../domain/thread.fixtures.js";
import type { ThreadRepository } from "../../ports/thread-repository.js";
import { ProjectSettingOfficeTools } from "./project-setting-office-tools.js";

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

/** How the session's Change Project settings rules, as HeldCalls would. */
export type Ruling = "allowed" | "ask-me" | "never";

/** Every change the tool asked of Projects, by method, with what it was given. */
export interface Change {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * The tool as registered, over a Projects that keeps what it was asked and a hold that rules as
 * told: Ask me holds a call until `allowOnce` approves it, and runs the same call once then, as
 * HeldCalls finds the approval by the call's words.
 */
export function toolsWith(
  ruling: Ruling,
  options: {
    readonly failingActions?: boolean;
    readonly project?: Project;
  } = {},
) {
  const project = options.project ?? SHOP;
  const changes: Change[] = [];
  const holds: HeldCallRequest[] = [];
  const approved: string[] = [];
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
    ...toolsOn({ projects, testTargets, actions, runEnvironments }, (request) => {
      holds.push(request);
      if (ruling === "allowed") return { kind: "proceed", roleKey: "devops" };
      if (ruling === "never") {
        return { kind: "refused", reason: "Your Role card says Never to Change Project settings." };
      }
      const spent = approved.indexOf(request.call);
      if (spent === -1) return { kind: "held", waitingOn: "the user" };
      approved.splice(spent, 1);
      return { kind: "proceed", roleKey: "devops" };
    }),
    changes,
    holds,
    /** The user's "Allow once" of the last call held. */
    allowOnce: () => {
      const last = holds.at(-1);
      if (last) approved.push(last.call);
    },
  };
}

/** What the tool changes Projects' settings through. */
export interface ProjectSettingServices {
  readonly projects: ProjectService;
  readonly testTargets: TestTargets;
  readonly actions: ProjectActions;
  readonly runEnvironments: RunEnvironmentSwitchRegistry;
}

/**
 * The tool as registered over `services`, in Nina's session on a Task, each call ruled by `rule`
 * (Allowed when left out).
 */
export function toolsOn(
  services: ProjectSettingServices,
  rule: (request: HeldCallRequest) => HeldCallOutcome = () => ({
    kind: "proceed",
    roleKey: "devops",
  }),
) {
  const heldCalls = {
    hold: (request: HeldCallRequest): Promise<HeldCallOutcome> => Promise.resolve(rule(request)),
  } as unknown as HeldCalls;
  const thread = aThread({ roleKey: "devops", home: { kind: "task", taskId: TASK } });
  const threads = {
    findBySession: (sessionId: string) =>
      Promise.resolve(sessionId === SESSION ? thread : undefined),
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
    heldCalls,
    threads,
    roleCards,
  ).onModuleInit();
  const [tool] = registry.named([CHANGE_PROJECT_SETTINGS_TOOL]);
  if (!tool) throw new Error(`${CHANGE_PROJECT_SETTINGS_TOOL} is not registered.`);
  return { tool };
}

/** Runs the tool on the input as the engine gives it: parsed, its defaults filled. */
export function runOf(tool: OfficeTool, input: unknown, sessionId = SESSION) {
  return tool.run(tool.input.parse(input), {
    sessionId,
    outputFolder: "",
    judgeCommand: () => Promise.resolve({ allowed: true }),
  });
}
