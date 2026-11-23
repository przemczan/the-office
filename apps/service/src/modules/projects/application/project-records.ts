import { Injectable } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import {
  ENGINE_TYPE_NAMES,
  EngineModels,
  type Engine,
  type EngineKind,
} from "../../engine/index.js";
import { ProjectServerValues, type ProjectMcpServerValues } from "../../mcp-servers/index.js";
import type { EnvironmentCheck } from "../domain/environment-check.js";
import type {
  ModelEffort,
  Project,
  ProjectStandIns,
  RunEnvironmentSetting,
} from "../domain/project.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { entryPointWords } from "../domain/entry-point.js";
import {
  isFeatureOn,
  PROJECT_FEATURE_REGISTRY,
  PROJECT_FEATURES,
} from "../domain/project-features.js";
import {
  fieldsOfKind,
  TEST_TARGET_KIND_NAMES,
  type TestTarget,
  type TestTargetField,
  type TestTargetSetter,
} from "../domain/test-target.js";
import {
  ACTION_FIELDS,
  ACTION_KIND_NAMES,
  ACTION_TIME_LIMIT_MINUTES,
  type Action,
  type ActionField,
  type ActionSetter,
} from "../domain/action.js";
import { ActionRepository } from "../ports/action-repository.js";
import { TestTargetRepository } from "../ports/test-target-repository.js";
import { BaseCheckouts } from "./base-checkouts.js";
import { EnvironmentChecks } from "./environment-checks.js";
import { ProjectDeviceLines, type ProjectDeviceLine } from "./project-device-lines.js";
import { ProjectService } from "./project-service.js";

/** What The Office reads of a Project beyond its own row, for its record. */
interface ProjectSurroundings {
  readonly checkout: string | undefined;
  readonly environmentCheck: EnvironmentCheck | undefined;
  readonly serverValues: readonly ProjectMcpServerValues[];
  readonly testTargets: readonly TestTarget[];
  readonly actions: readonly Action[];
  readonly devices: readonly ProjectDeviceLine[];
  /** The engines listed now, which name the Project default's account. */
  readonly engines: readonly Engine[];
}

const RUN_ENVIRONMENT_WORDS: Readonly<Record<RunEnvironmentSetting, string>> = {
  "not-decided": "not decided yet",
  on: "on",
  off: "off",
};

/**
 * The Projects' records as an Agent reads them: `list_projects` gives them all, and a chat message
 * sent beside a Project's page gives its own (spec §2.4). Each holds what the Project's page shows,
 * a Secret variable's and a secret Server value's value left out (spec §6).
 */
@Injectable()
export class ProjectRecords {
  constructor(
    private readonly projects: ProjectService,
    private readonly bases: BaseCheckouts,
    private readonly environmentChecks: EnvironmentChecks,
    private readonly serverValues: ProjectServerValues,
    private readonly testTargets: TestTargetRepository,
    private readonly actions: ActionRepository,
    private readonly devices: ProjectDeviceLines,
    private readonly engines: EngineModels,
  ) {}

  /** Every Project's record, or that there is none. */
  async everyone(): Promise<string> {
    const projects = await this.projects.list();
    if (projects.length === 0) return "The Office works on no Project yet.";
    const checkouts = await this.checkoutFolders();
    const records = await readEach(projects, async (project) =>
      projectRecord(project, await this.surroundingsOf(project, checkouts)),
    );
    return records.join("\n\n");
  }

  /** The Project's record; undefined when The Office has no such Project. */
  async of(projectId: string): Promise<string | undefined> {
    const project = await this.projects.find(projectId);
    if (!project) return undefined;
    return projectRecord(project, await this.surroundingsOf(project, await this.checkoutFolders()));
  }

  private async surroundingsOf(
    project: Project,
    checkouts: ReadonlyMap<string, string>,
  ): Promise<ProjectSurroundings> {
    const [environmentCheck, serverValues, testTargets, actions, devices, engines] =
      await Promise.all([
        this.environmentChecks.latest(project.id),
        this.serverValues.of(project.id),
        this.testTargets.listOf(project.id),
        this.actions.listOf(project.id),
        this.devices.of(project.id),
        this.engines.engines(),
      ]);
    return {
      checkout: checkouts.get(project.id),
      environmentCheck,
      serverValues,
      testTargets,
      actions,
      devices,
      engines,
    };
  }

  private async checkoutFolders(): Promise<ReadonlyMap<string, string>> {
    return new Map(
      (await this.bases.list()).map((checkout) => [checkout.projectId, checkout.folder]),
    );
  }
}

function projectRecord(project: Project, surroundings: ProjectSurroundings): string {
  const { checkout, environmentCheck, serverValues, testTargets, actions, devices } = surroundings;
  const commands = project.commands.map(
    ({ key, name, kind, commandLine }) => `${key} (${name}, ${kind}) \`${commandLine || "none"}\``,
  );
  return [
    `${project.name} (id ${project.id})`,
    `- Path: ${project.path}${project.repositoryUrl ? `, cloned from ${project.repositoryUrl}` : ""}`,
    `- Base branch: ${project.baseBranch}${checkout ? `, read-only in chats at ${checkout}` : ""}`,
    `- Install: \`${project.installCommand || "none"}\``,
    `- Commands: ${commands.length > 0 ? commands.join(", ") : "none"}`,
    `- Install inputs: ${listed(project.installInputs)}`,
    `- Publishing: ${project.publishingMode === "merge" ? `merge into ${project.baseBranch}` : "push and open a pull request"}`,
    `- Before publishing: \`${project.beforePublishingCommand || "none"}\``,
    `- After publishing: \`${project.afterPublishingCommand || "none"}\``,
    `- Delete branches once merged: ${project.deleteMergedBranches ? "on" : "off"}`,
    `- Default Pipeline: ${project.defaultPipeline}`,
    `- Project limit: ${project.projectLimit} Task${project.projectLimit === 1 ? "" : "s"} started at once`,
    `- Run environment: ${RUN_ENVIRONMENT_WORDS[project.runEnvironment]}`,
    `- Features: ${featuresWords(project)}`,
    ...environmentLines(project.environment),
    `- Environment check: ${environmentCheckWords(environmentCheck)}`,
    ...engineLines(project, surroundings.engines),
    `- Project skills: ${projectSkillsWords(project)}`,
    `- Server values: ${serverValuesWords(serverValues)}`,
    ...testTargetLines(testTargets),
    ...actionLines(actions),
    ...deviceLines(devices),
  ].join("\n");
}

/** Each of its devices by id, name, kind and state, never its address or Port (spec §2.13). */
function deviceLines(devices: readonly ProjectDeviceLine[]): string[] {
  if (devices.length === 0) return ["- Devices: none"];
  return [
    "- Devices:",
    ...devices.map(({ id, kind, name, state }) => `  - ${id} (${name}, ${kind}): ${state}`),
  ];
}

/** Every feature on or off as read now; one off for a feature it needs says so. */
function featuresWords(project: Project): string {
  return PROJECT_FEATURES.map((feature) => {
    const { name, needs } = PROJECT_FEATURE_REGISTRY[feature];
    if (isFeatureOn(project, feature)) return `${name} on`;
    const missing = needs.filter((needed) => !isFeatureOn(project, needed));
    const why = missing.map((needed) => PROJECT_FEATURE_REGISTRY[needed].name).join(", ");
    return missing.length > 0 ? `${name} off (needs ${why})` : `${name} off`;
  }).join(", ");
}

const TEST_TARGET_FIELD_WORDS: Readonly<Record<TestTargetField, string>> = {
  name: "name",
  kind: "kind",
  entryPoint: "entry point",
  port: "port",
  outputPatterns: "output files",
  variables: "variables",
  secretVariables: "Secret variables",
  commandsBefore: "commands before the entry point",
  portVariable: "port variable",
  memoryMegabytes: "memory per service",
};

/** Each target with who set each value last; a Secret variable by name alone (spec §2.12). */
function testTargetLines(targets: readonly TestTarget[]): string[] {
  if (targets.length === 0) return ["- Test targets: none"];
  return [
    "- Test targets:",
    ...targets.map((target) => {
      const own =
        target.kind === "build-to-install"
          ? `output files ${listed(target.outputPatterns)}`
          : `port ${target.port} in \`${target.portVariable}\``;
      const secrets = target.secretVariables.map(
        ({ name, value }) => `${name} (${value === null ? "no value" : "value set"})`,
      );
      return [
        `  - ${target.key} (${target.name}, ${TEST_TARGET_KIND_NAMES[target.kind]}): ${entryPointWords(target.entryPoint)}; ${own}`,
        `variables ${listed(target.variables.map(({ name, value }) => `\`${name}=${value}\``))}`,
        `Secret variables (values never shown) ${listed(secrets)}`,
        `commands before the entry point ${listed(target.commandsBefore)}`,
        `memory per service ${target.memoryMegabytes === null ? "the Office-wide value" : `${target.memoryMegabytes / 1024} GB`}`,
        `set by: ${setByWords(target)}`,
      ].join("; ");
    }),
  ];
}

const ACTION_FIELD_WORDS: Readonly<Record<ActionField, string>> = {
  name: "name",
  kind: "kind",
  settings: "settings",
  leavesTheWorkstation: "leaves the workstation",
};

/** Each Action with its settings and who set each value last (spec §2.15, "Action"). */
function actionLines(actions: readonly Action[]): string[] {
  if (actions.length === 0) return ["- Actions: none"];
  return [
    "- Actions:",
    ...actions.map((action) => {
      const setBy = ACTION_FIELDS.map((field) => {
        const setter = action.setBy[field];
        return `${ACTION_FIELD_WORDS[field]} ${setter ? setterWords(setter) : "unknown"}`;
      }).join(", ");
      return [
        `  - ${action.key} (${action.name}, ${ACTION_KIND_NAMES[action.kind]}): ${actionSettingsWords(action)}`,
        action.leavesTheWorkstation ? "leaves the workstation" : "stays on the workstation",
        `set by: ${setBy}`,
      ].join("; ");
    }),
  ];
}

function actionSettingsWords(action: Action): string {
  switch (action.kind) {
    case "project-command": {
      const { commandKey, commandsBefore, timeLimitMinutes } = action.settings;
      const limit =
        timeLimitMinutes === null
          ? `the default ${ACTION_TIME_LIMIT_MINUTES.default} minutes`
          : `${timeLimitMinutes} minutes`;
      return `command ${commandKey}; commands before it ${listed(commandsBefore)}; time limit ${limit}`;
    }
    case "test-target":
      return `test target ${action.settings.targetKey}`;
    case "workflow": {
      const inputs = Object.entries(action.settings.inputs).map(
        ([name, value]) => `\`${name}=${value}\``,
      );
      return `Workflow ${action.settings.file}; inputs ${listed(inputs)}`;
    }
  }
}

function setByWords(target: TestTarget): string {
  const setters = fieldsOfKind(target.kind).map((field) => {
    const setter = target.setBy[field];
    return `${TEST_TARGET_FIELD_WORDS[field]} ${setter ? setterWords(setter) : "unknown"}`;
  });
  return setters.join(", ");
}

function setterWords(setter: TestTargetSetter | ActionSetter): string {
  return setter.by === "user"
    ? `the user ${setter.user.name}`
    : `a Proposal by ${setter.agent.name} (${setter.agent.roleKey})`;
}

function environmentLines({ set, unset, prependPath }: ProjectEnvironment): string[] {
  const plain = set.filter((variable) => !variable.secret);
  const secrets = set.filter((variable) => variable.secret);
  return [
    `- Variables to set: ${listed(plain.map(({ name, value }) => `\`${name}=${value}\``))}`,
    `- Secret variables (values never shown): ${listed(
      secrets.map(({ name, value }) => `${name} (${value === "" ? "no value" : "value set"})`),
    )}`,
    `- Variables to remove: ${listed(unset)}`,
    `- Folders in front of PATH: ${listed(prependPath)}`,
  ];
}

function environmentCheckWords(check: EnvironmentCheck | undefined): string {
  if (!check) return "never run";
  if (check.state === "running") return `running since ${check.startedAt.toISOString()}`;
  const finished = `${check.state}, ${(check.finishedAt ?? check.startedAt).toISOString()}`;
  const failed = check.checks
    .filter((each) => each.state === "failed")
    .map((each) => (each.step === "command" ? each.key : each.step));
  return failed.length > 0 ? `${finished}; failed: ${failed.join(", ")}` : finished;
}

/** The Project's levels of both cascades (spec §5.4.5), as its Engine block shows them. */
function engineLines({ engine }: Project, engines: readonly Engine[]): string[] {
  const { default: projectDefault, force } = engine;
  const account =
    projectDefault &&
    (engines.find(({ id }) => id === projectDefault.engineId)?.name ?? projectDefault.engineId);
  const people = engine.people.map(({ roleKey, engineSettings }) => {
    const types = Object.entries(engineSettings).map(
      ([type, setting]) =>
        `${ENGINE_TYPE_NAMES[type as EngineKind]} ${modelEffortWords(setting, "Person's setting")}`,
    );
    return `${roleKey}: ${types.join(", ")}`;
  });
  return [
    `- Default engine: ${projectDefault ? `${ENGINE_TYPE_NAMES[projectDefault.engineType]}, account ${account}` : "the Office's default"}`,
    `- Forced model and effort: ${projectDefault && force ? `${ENGINE_TYPE_NAMES[projectDefault.engineType]}: ${modelEffortWords(force, "Engine's default")}` : "none"}`,
    `- Model and effort per person: ${people.length > 0 ? people.join("; ") : "none"}`,
    `- Stand-in Engines: ${standInsWords(engine.standIns, engines)}`,
  ];
}

/** Whose Stand-in Engine list applies in the Project, the Project's own by engine name in order. */
function standInsWords(
  { useOwnList, engineIds }: ProjectStandIns,
  engines: readonly Engine[],
): string {
  if (!useOwnList) return "the Office's";
  const names = engineIds.map(
    (engineId) => engines.find(({ id }) => id === engineId)?.name ?? engineId,
  );
  return `the Project's own (${names.length > 0 ? names.join(", ") : "none"})`;
}

/** "<model> · <effort>", each unset one in the words of the level below. */
function modelEffortWords({ model, effort }: ModelEffort, unset: string): string {
  return `${model ?? unset} · ${effort ?? unset}`;
}

function projectSkillsWords({ useProjectSkills, projectSkillsOff }: Project): string {
  if (!useProjectSkills) return "not used";
  return projectSkillsOff.length > 0 ? `used, but off: ${projectSkillsOff.join(", ")}` : "used";
}

function serverValuesWords(servers: readonly ProjectMcpServerValues[]): string {
  const values = servers.flatMap(({ serverName, serverValues }) =>
    serverValues.map(({ serverValue, projectValue }) => {
      const name = `${serverName} ${serverValue.name}`;
      if (projectValue === undefined) {
        return `${name}: ${serverValue.officeWideValue === undefined ? "not set" : "the Office-wide value"}`;
      }
      return `${name}: ${serverValue.secret ? "the Project's own secret value" : `the Project's own \`${projectValue}\``}`;
    }),
  );
  return listed(values);
}

function listed(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}
