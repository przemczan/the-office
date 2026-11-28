import { createHash } from "node:crypto";
import { isAbsolute, posix, relative, sep } from "node:path";
import type { Reading, RunEnvironmentDefinition } from "./run-environment-definition.js";

/** A variable the install command runs with while the image builds: the Project's `set`. */
export interface InstallVariable {
  readonly name: string;
  readonly value: string;
  /** A Secret variable, whose value is in no image layer and not in the key. */
  readonly secret: boolean;
}

/**
 * What a Project's image is made from: the definition and Install inputs in a folder (a Task's
 * worktree, or a Test instance's checkout) and the Project's install command and variables.
 */
export interface ImageSource {
  readonly projectId: string;
  /** The folder the definition and the Install inputs are read from, an absolute path. */
  readonly worktree: string;
  readonly installCommand: string | undefined;
  /** Relative to the folder. */
  readonly installInputs: readonly string[];
  readonly installVariables: readonly InstallVariable[];
}

/** A Task whose checks run in a run environment, and what its image is made from. */
export interface TaskInWorktree {
  readonly taskId: string;
  /** For what The Office is busy with, in the UI's words. */
  readonly taskTitle: string;
  readonly projectId: string;
  /** The Task's worktree, an absolute path: mounted at the same path inside (spec §5.5). */
  readonly worktree: string;
  /**
   * The git folder the worktree's repository shares, an absolute path as git on the host names it:
   * mounted read-only at the same path inside, where the worktree's `.git` file leads.
   */
  readonly repositoryGitFolder: string;
  /**
   * The folder of the file of the Task's earlier Stage runs, which a condition command reads
   * (spec §2.3), an absolute path: mounted read-only at the same path inside. The folder, never the
   * file, since a file's bind mount keeps the inode it started with and the file is written anew.
   */
  readonly stageRunsFolder: string;
  readonly installCommand: string | undefined;
  /** The Project's Install inputs, relative to the worktree. */
  readonly installInputs: readonly string[];
  /** The variables the install command runs with as the image builds. */
  readonly installVariables: readonly InstallVariable[];
}

/** How a check changes the variables it runs with: the Project's environment (spec §5.5). */
export interface CommandEnvironment {
  readonly set: readonly { readonly name: string; readonly value: string }[];
  readonly unset: readonly string[];
  readonly prependPath: readonly string[];
}

/**
 * The CPU limit's choice: Automatic follows this computer's cores (`automaticCpusOf`), Fixed puts
 * one number on every service.
 */
export type CpuLimitChoice = "automatic" | "fixed";

/** The CPU limit; the fixed number is kept while Automatic is chosen, for the next switch back. */
export interface CpuLimit {
  readonly choice: CpuLimitChoice;
  readonly fixedCpus: number;
}

/** Each run environment's limits, set Office-wide (spec §5.5, "Limits"). */
export interface RunEnvironmentLimits {
  readonly cpuLimit: CpuLimit;
  readonly memoryMegabytes: number;
  readonly processes: number;
}

/** The cores Automatic leaves to The Office and the rest of the computer. */
export const CORES_LEFT_FOR_THE_HOST = 2;
/** Automatic's cap on every service but the checks' one, such as Postgres. */
export const OTHER_SERVICES_CPUS = 2;

/** What Automatic gives each run environment on a computer with this many cores. */
export interface AutomaticCpus {
  readonly checksCpus: number;
  readonly otherServicesCpus: number;
}

/**
 * Every run environment gets the same caps rather than a share of the cores: the container runtime
 * weighs running containers equally, so one running Task can use the idle cores and two split them.
 */
export function automaticCpusOf(hostCores: number): AutomaticCpus {
  const checksCpus = Math.max(1, hostCores - CORES_LEFT_FOR_THE_HOST);
  return { checksCpus, otherServicesCpus: Math.min(OTHER_SERVICES_CPUS, checksCpus) };
}

/**
 * The CPUs one service of a run environment may use. A fixed number saved on a computer with more
 * cores is held to this one's, since the container runtime refuses to start a service asking for more.
 */
export function serviceCpusOf(
  cpuLimit: CpuLimit,
  hostCores: number,
  isChecksService: boolean,
): number {
  if (cpuLimit.choice === "fixed") return Math.min(cpuLimit.fixedCpus, hostCores);
  const automatic = automaticCpusOf(hostCores);
  return isChecksService ? automatic.checksCpus : automatic.otherServicesCpus;
}

/** Why a CPU limit can't be saved on this computer, in the UI's words; undefined when it can. */
export function cpuLimitProblemOf(cpuLimit: CpuLimit, hostCores: number): string | undefined {
  if (cpuLimit.fixedCpus < 1 || cpuLimit.fixedCpus > hostCores) {
    return `A fixed CPU limit is between 1 and this computer's ${hostCores} cores.`;
  }
  return undefined;
}

/** The Office-wide settings of run environments. */
export interface RunEnvironmentOptions {
  readonly limits: RunEnvironmentLimits;
  /** Run environments at once: how many may be running together. */
  readonly runEnvironmentsAtOnce: number;
}

/** The spec's defaults, until Settings changes them. */
export const DEFAULT_RUN_ENVIRONMENT_OPTIONS: RunEnvironmentOptions = {
  limits: {
    cpuLimit: { choice: "automatic", fixedCpus: 2 },
    memoryMegabytes: 4096,
    processes: 1024,
  },
  runEnvironmentsAtOnce: 2,
};

/** How long a run environment stays running after its last check (spec §5.5, "Running"). */
export const IDLE_STOP_MS = 10 * 60 * 1000;

/** The labels on what The Office creates in the container runtime. */
export const LABEL = {
  managed: "office.managed",
  /** Which Office: each Office data directory is one, so a test's Office never sweeps another's. */
  instance: "office.instance",
  task: "office.task",
  project: "office.project",
  /** A Hosted Test instance's compose project, by the instance's id. */
  testInstance: "office.test-instance",
  /** A Project's build cache volume, which Build to install Test instances share. */
  buildCache: "office.build-cache",
  /** A pairing environment's compose project, by the Project device's id. */
  pairing: "office.pairing",
  /** An Action's Project command run's compose project, by the run's id. */
  actionRun: "office.action-run",
} as const;

export type Labels = Readonly<Record<string, string>>;

/** The Office instance's id, from its data directory. */
export function instanceIdOf(officeDataDirectory: string): string {
  return createHash("sha256").update(officeDataDirectory).digest("hex").slice(0, 12);
}

/** The labels of everything this Office creates; images carry these alone. */
export function officeLabels(instance: string): Labels {
  return { [LABEL.managed]: "true", [LABEL.instance]: instance };
}

/** The labels of what a Task's run environment holds; its Task's are enough to find it. */
export function taskLabels(instance: string, taskId: string): Labels {
  return { ...officeLabels(instance), [LABEL.task]: taskId };
}

/** The compose project of a Task's run environment, unique to the Office and the Task. */
export function composeProjectNameOf(instance: string, taskId: string): string {
  return `office-${instance}-${taskId}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

/**
 * The compose file The Office puts over the repository's: the image, the worktree, the git folder,
 * the Stage runs' folder and the device helper's on the checks' service, The Office's labels on
 * every service, network and volume, and the limits on every service. Compose takes a later file's
 * values over an earlier one's, so the definition can't undo any of it. No service gets `cpu_shares`: the runtime's
 * default weight is already equal, and an explicit 1024 would lower it under cgroup v2.
 */
export function composeOverrideOf(
  definition: RunEnvironmentDefinition,
  task: TaskInWorktree,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
  hostCores: number,
  /** `<office-data>/device-helper/`, mounted read-only at DEVICE_HELPER_MOUNT. */
  deviceHelperFolder: string,
): Record<string, unknown> {
  const labels = { ...taskLabels(instance, task.taskId), [LABEL.project]: task.projectId };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        ...serviceLimitsOf(limits, hostCores, service === definition.service),
        ...(service === definition.service
          ? checksServiceOverride(definition, task, image, deviceHelperFolder)
          : {}),
      },
    ]),
  );
  return { services, ...networksAndVolumesOf(definition, labels) };
}

/** The Office's limits on one service: the checks' service is the one Automatic gives the most. */
function serviceLimitsOf(
  limits: RunEnvironmentLimits,
  hostCores: number,
  isChecksService: boolean,
): Record<string, unknown> {
  return {
    cpus: serviceCpusOf(limits.cpuLimit, hostCores, isChecksService),
    mem_limit: `${limits.memoryMegabytes}m`,
    // No swap above the memory limit, so the limit holds.
    memswap_limit: `${limits.memoryMegabytes}m`,
    pids_limit: limits.processes,
  };
}

/** The labels on the default network and every network and volume the definition declares. */
function networksAndVolumesOf(
  definition: RunEnvironmentDefinition,
  labels: Labels,
): { networks: Record<string, unknown>; volumes?: Record<string, unknown> } {
  return {
    networks: Object.fromEntries(
      ["default", ...definition.networks].map((network) => [network, { labels }]),
    ),
    ...(definition.volumes.length > 0
      ? { volumes: Object.fromEntries(definition.volumes.map((volume) => [volume, { labels }])) }
      : {}),
  };
}

/** The labels of what a Hosted Test instance's compose project holds; its id is enough to find it. */
export function testInstanceLabels(instance: string, testInstanceId: string): Labels {
  return { ...officeLabels(instance), [LABEL.testInstance]: testInstanceId };
}

/**
 * The compose project of a Hosted Test instance (spec §5.5, "A test instance's checkout"), unique
 * to the Office and the instance, and never a Task's, whose ids carry no `test-`.
 */
export function hostedProjectNameOf(instance: string, testInstanceId: string): string {
  return composeProjectNameOf(instance, `test-${testInstanceId}`);
}

/** What a Hosted Test instance's override is made of, beside the definition, image and limits. */
export interface HostedRun {
  readonly testInstanceId: string;
  readonly projectId: string;
  /** The instance's checkout, an absolute path: the one host folder mounted, at its own path. */
  readonly checkout: string;
  /** The service the app runs in: the devcontainer's own, or the one the entry point names. */
  readonly appService: string;
  /** The port the app listens on inside its service, published on 127.0.0.1 alone. */
  readonly containerPort: number;
  /** The target's variables' names, each given its value from its carrier (`carrierOf`) by index. */
  readonly variableNames: readonly string[];
  /** The variable set to `containerPort` in the app's service (spec §2.12, "What The Office sets"). */
  readonly portVariable: string;
}

/** Set in the app's service, so The Office run as a test instance refuses what reaches outside. */
export const TEST_INSTANCE_VARIABLE = "OFFICE_TEST_INSTANCE";

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The compose file The Office puts over the repository's for a Hosted Test instance (spec §2.12,
 * "Safety"): the checkout alone mounted, at its own path, in the devcontainer's service on the
 * Project's image; the app's port alone published, on 127.0.0.1 at a port the runtime picks; the
 * target's variables in the app's service by their carriers, never their values; the labels on
 * every service, network and volume, and the limits on every service. The definition is one
 * `readDefinition` took, so it sets no ports, host mounts, limits or privileges of its own.
 */
export function hostedOverrideOf(
  definition: RunEnvironmentDefinition,
  run: HostedRun,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
  hostCores: number,
): Reading<Record<string, unknown>> {
  const problems: string[] = [];
  if (!definition.services.includes(run.appService)) {
    problems.push(
      `The service ${run.appService} the entry point names isn't in the run environment definition.`,
    );
  }
  if (!Number.isInteger(run.containerPort) || run.containerPort < 1 || run.containerPort > 65_535) {
    problems.push(`The port ${run.containerPort} isn't a port from 1 to 65535.`);
  }
  problems.push(...variableNameProblems(run.variableNames));
  problems.push(...portVariableProblems(run.portVariable, run.variableNames));
  if (problems.length > 0) return { problems };

  const labels = {
    ...testInstanceLabels(instance, run.testInstanceId),
    [LABEL.project]: run.projectId,
  };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        ...serviceLimitsOf(limits, hostCores, service === definition.service),
        ...(service === definition.service
          ? devcontainerServiceOverride(definition, run.checkout, image, [
              bindMount(run.checkout, false),
            ])
          : {}),
        ...(service === run.appService
          ? {
              environment: {
                ...testInstanceEnvironmentOf(run.variableNames),
                [run.portVariable]: String(run.containerPort),
              },
              ports: [`127.0.0.1::${run.containerPort}`],
            }
          : {}),
      },
    ]),
  );
  return { value: { services, ...networksAndVolumesOf(definition, labels) }, problems: [] };
}

/** What a Build to install Test instance's override is made of, beside the definition and image. */
export interface TestBuildRun {
  readonly testInstanceId: string;
  readonly projectId: string;
  /** The instance's checkout, an absolute path: the one host folder mounted, at its own path. */
  readonly checkout: string;
  /** The target's variables' names, each given its value from its carrier (`carrierOf`) by index. */
  readonly variableNames: readonly string[];
}

/** Where the Project's build cache volume is mounted in the devcontainer's service. */
export const BUILD_CACHE_FOLDER = "/office-build-cache";

/**
 * Where the build tools keep what a build may reuse (spec §5.5, "The build cache volume"): Gradle's
 * and npm's caches, and Android's user folder with its debug signing key, each in the volume.
 */
export const BUILD_CACHE_VARIABLES: Readonly<Record<string, string>> = {
  GRADLE_USER_HOME: `${BUILD_CACHE_FOLDER}/gradle`,
  npm_config_cache: `${BUILD_CACHE_FOLDER}/npm`,
  ANDROID_USER_HOME: `${BUILD_CACHE_FOLDER}/android`,
};

/**
 * Run as root before a build whose devcontainer names a user: a fresh named volume is root's, so
 * the caches' folders are made and given to the user (`$1`) the build runs as, or the build tools
 * couldn't write there. Not recursive, so a large cache costs nothing.
 */
export const BUILD_CACHE_OWNERSHIP_SCRIPT = `user="$1"; shift; mkdir -p -- "$@" && chown -- "$user" "$@"`;

/** The folders `BUILD_CACHE_OWNERSHIP_SCRIPT` gives to the build's user. */
export const BUILD_CACHE_FOLDERS: readonly string[] = [
  BUILD_CACHE_FOLDER,
  ...Object.values(BUILD_CACHE_VARIABLES),
];

/** The key of the build cache volume in the override's `volumes`. */
const BUILD_CACHE_VOLUME_KEY = "office-build-cache";

/**
 * The Project's build cache volume, one per Project and Office: a named volume, never a host
 * folder, made before the build and kept after it, as no instance's label or compose project is on
 * it.
 */
export function buildCacheVolumeOf(instance: string, projectId: string): string {
  return `office-${instance}-build-cache-${projectId}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

/** The labels of a Project's build cache volume: this Office's and the Project's. */
export function buildCacheLabels(instance: string, projectId: string): Labels {
  return { ...officeLabels(instance), [LABEL.project]: projectId, [LABEL.buildCache]: "true" };
}

/**
 * The compose file The Office puts over the repository's for a Build to install Test instance
 * (spec §2.12, "Build to install"): as a Hosted one's, the checkout alone mounted from the host,
 * with the Project's build cache volume beside it in the devcontainer's service, where the build
 * runs, and no port published.
 */
export function buildOverrideOf(
  definition: RunEnvironmentDefinition,
  run: TestBuildRun,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
  hostCores: number,
): Reading<Record<string, unknown>> {
  const problems = variableNameProblems(run.variableNames);
  if (problems.length > 0) return { problems };

  const labels = {
    ...testInstanceLabels(instance, run.testInstanceId),
    [LABEL.project]: run.projectId,
  };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        ...serviceLimitsOf(limits, hostCores, service === definition.service),
        ...(service === definition.service
          ? {
              ...devcontainerServiceOverride(definition, run.checkout, image, [
                bindMount(run.checkout, false),
                { type: "volume", source: BUILD_CACHE_VOLUME_KEY, target: BUILD_CACHE_FOLDER },
              ]),
              environment: {
                ...BUILD_CACHE_VARIABLES,
                ...testInstanceEnvironmentOf(run.variableNames),
              },
            }
          : {}),
      },
    ]),
  );
  const { networks, volumes } = networksAndVolumesOf(definition, labels);
  return {
    value: {
      services,
      networks,
      volumes: {
        ...volumes,
        // External, so `down --volumes` leaves it for the next build.
        [BUILD_CACHE_VOLUME_KEY]: {
          name: buildCacheVolumeOf(instance, run.projectId),
          external: true,
        },
      },
    },
    problems: [],
  };
}

/** What an Install on a device Test instance's override is made of, beside the definition and image. */
export interface TestInstallRun {
  readonly testInstanceId: string;
  readonly projectId: string;
  /** `<office-data>/device-helper/`, mounted read-only at DEVICE_HELPER_MOUNT. */
  readonly deviceHelperFolder: string;
  /** The build's kept files, `<office-data>/test-builds/<build id>/`, mounted read-only at TEST_BUILD_FILES_MOUNT. */
  readonly buildFiles: string;
}

/**
 * Where an Install on a device Test instance's devcontainer service sees the files of the build it
 * installs: one path whatever the Office data directory is.
 */
export const TEST_BUILD_FILES_MOUNT = "/office-test-build";

/**
 * The compose file The Office puts over the checkout's for an Install on a device Test instance
 * (spec §2.12, "Installing"): the devcontainer's service on the Project's image with two host
 * folders alone, both read-only, the device helper's at DEVICE_HELPER_MOUNT and the build's kept
 * files at TEST_BUILD_FILES_MOUNT; no checkout, no target variables and no port; the labels on
 * every service, network and volume, and the Office-wide limits on every service.
 */
export function installOverrideOf(
  definition: RunEnvironmentDefinition,
  run: TestInstallRun,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
  hostCores: number,
): Record<string, unknown> {
  const labels = {
    ...testInstanceLabels(instance, run.testInstanceId),
    [LABEL.project]: run.projectId,
  };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        ...serviceLimitsOf(limits, hostCores, service === definition.service),
        ...(service === definition.service
          ? devcontainerServiceOverride(definition, undefined, image, [
              deviceHelperMount(run.deviceHelperFolder),
              { ...bindMount(run.buildFiles, true), target: TEST_BUILD_FILES_MOUNT },
            ])
          : {}),
      },
    ]),
  );
  return { services, ...networksAndVolumesOf(definition, labels) };
}

/** The labels of what an Action run's compose project holds; the run's id is enough to find it. */
export function actionRunLabels(instance: string, runId: string): Labels {
  return { ...officeLabels(instance), [LABEL.actionRun]: runId };
}

/**
 * The compose project of an Action's Project command run (spec §5.5, "An Action run's checkout"),
 * unique to the Office and the run, and never a Task's, a Test instance's or a pairing's, whose ids
 * carry no `action-`.
 */
export function actionRunProjectNameOf(instance: string, runId: string): string {
  return composeProjectNameOf(instance, `action-${runId}`);
}

/** What an Action run's override is made of, beside the definition, image and limits. */
export interface ActionRunMounts {
  readonly runId: string;
  readonly projectId: string;
  /** The run's checkout, an absolute path: the one host folder mounted, at its own path. */
  readonly checkout: string;
  /** `<office-data>/device-helper/`, mounted read-only when the Action names a device; else none. */
  readonly deviceHelperFolder: string | undefined;
}

/**
 * The compose file The Office puts over the checkout's for an Action's Project command run (spec
 * §5.5, "An Action run's checkout"): the checkout alone mounted, at its own path, in the
 * devcontainer's service on the Project's image, with the device helper's folder when the Action
 * names a device; no port published; the labels on every service, network and volume, and the
 * limits on every service. Its variables reach each command by `exec`, never the override.
 */
export function actionRunOverrideOf(
  definition: RunEnvironmentDefinition,
  run: ActionRunMounts,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
  hostCores: number,
): Record<string, unknown> {
  const labels = { ...actionRunLabels(instance, run.runId), [LABEL.project]: run.projectId };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        ...serviceLimitsOf(limits, hostCores, service === definition.service),
        ...(service === definition.service
          ? devcontainerServiceOverride(definition, run.checkout, image, [
              bindMount(run.checkout, false),
              ...(run.deviceHelperFolder === undefined
                ? []
                : [deviceHelperMount(run.deviceHelperFolder)]),
            ])
          : {}),
      },
    ]),
  );
  return { services, ...networksAndVolumesOf(definition, labels) };
}

/** The labels of what a pairing environment holds; the Project device's id is enough to find it. */
export function pairingLabels(instance: string, deviceId: string): Labels {
  return { ...officeLabels(instance), [LABEL.pairing]: deviceId };
}

/**
 * The compose project of a pairing environment (spec §5.5, "A pairing environment"), unique to the
 * Office and the Project device, and never a Task's or a Test instance's, whose ids carry no
 * `pairing-`.
 */
export function pairingProjectNameOf(instance: string, deviceId: string): string {
  return composeProjectNameOf(instance, `pairing-${deviceId}`);
}

/** What a pairing environment's override is made of, beside the definition, image and limits. */
export interface PairingRun {
  readonly deviceId: string;
  readonly projectId: string;
  /** `<office-data>/device-helper/`, mounted read-only at DEVICE_HELPER_MOUNT. */
  readonly deviceHelperFolder: string;
}

/**
 * The compose file The Office puts over the base branch's definition for a pairing environment
 * (spec §5.5, "A pairing environment"): the devcontainer's service on the image, with the device
 * helper's folder alone mounted from the host, read-only, no checkout and no port; the labels on
 * every service, network and volume, and the limits on every service.
 */
export function pairingOverrideOf(
  definition: RunEnvironmentDefinition,
  run: PairingRun,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
  hostCores: number,
): Record<string, unknown> {
  const labels = { ...pairingLabels(instance, run.deviceId), [LABEL.project]: run.projectId };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        ...serviceLimitsOf(limits, hostCores, service === definition.service),
        ...(service === definition.service
          ? devcontainerServiceOverride(definition, undefined, image, [
              deviceHelperMount(run.deviceHelperFolder),
            ])
          : {}),
      },
    ]),
  );
  return { services, ...networksAndVolumesOf(definition, labels) };
}

/**
 * Why the Project's variables can't reach a run environment: one set under a name a shell can't
 * hold, saved before Projects refused such a name, would break the script that exports it under
 * that name (`commandScript`) and the install's mount of it (`installDockerfile`), so nothing runs.
 */
export function projectVariableNameProblems(names: readonly string[]): string[] {
  return names.flatMap((name) =>
    VARIABLE_NAME.test(name)
      ? []
      : [
          `The Project's variable ${JSON.stringify(name)} can't reach a run environment: a name takes letters, digits and _, not starting with a digit. Rename it in the Project's Environment.`,
        ],
  );
}

function variableNameProblems(names: readonly string[]): string[] {
  return names.flatMap((name) =>
    VARIABLE_NAME.test(name)
      ? []
      : [
          `The variable name ${JSON.stringify(name)} isn't one: use letters, digits and _, not starting with a digit.`,
        ],
  );
}

/**
 * Why the port variable can't be set: not a name, the test instance's mark, or one of the target's
 * own variables, which the Project page refuses already; a defence here.
 */
function portVariableProblems(name: string, variableNames: readonly string[]): string[] {
  if (!VARIABLE_NAME.test(name)) {
    return [
      `The port variable ${JSON.stringify(name)} isn't a variable name: use letters, digits and _, not starting with a digit.`,
    ];
  }
  if (name === TEST_INSTANCE_VARIABLE) {
    return [`The port variable ${name} is one The Office sets itself.`];
  }
  if (variableNames.includes(name)) {
    return [`The port variable ${name} is also one of the target's variables.`];
  }
  return [];
}

/** The target's variables by their carriers, never their values, and the test instance's mark. */
function testInstanceEnvironmentOf(variableNames: readonly string[]): Record<string, string> {
  return {
    ...Object.fromEntries(variableNames.map((name, index) => [name, `\${${carrierOf(index)}}`])),
    [TEST_INSTANCE_VARIABLE]: "true",
  };
}

/** How an entry point runs in the devcontainer's service: its folder and its arguments, no shell. */
export interface EntryPointCommand {
  /** An absolute path inside the checkout. */
  readonly folder: string;
  readonly argv: readonly string[];
}

/** The entry points The Office runs itself; a devcontainer service is the app with no command. */
export type CommandEntryPoint =
  | {
      readonly kind: "repository-file";
      readonly path: string;
      readonly arguments: readonly string[];
    }
  | {
      readonly kind: "package-script";
      readonly manifest: string;
      readonly script: string;
      readonly arguments: readonly string[];
    }
  | { readonly kind: "gradle-task"; readonly task: string; readonly arguments: readonly string[] };

/**
 * A test target's entry point (spec §2.12, "Entry points only"), as contracts' `EntryPoint` has
 * it: one The Office runs as a command, or a devcontainer service that is the app itself.
 */
export type HostedEntryPoint =
  CommandEntryPoint | { readonly kind: "devcontainer-service"; readonly service: string };

/**
 * The command of an entry point (spec §2.12, "Entry points only"), given to the runtime as
 * arguments one by one: a repository file run as `./<path>` from the checkout, a package script by
 * `npm run` in its manifest's folder, a Gradle task through the repository's `./gradlew`. A path
 * leading out of the checkout is refused.
 */
export function entryPointCommandOf(
  entryPoint: CommandEntryPoint,
  checkout: string,
): { readonly command: EntryPointCommand } | { readonly problem: string } {
  switch (entryPoint.kind) {
    case "repository-file": {
      const path = repositoryPath(entryPoint.path);
      if (path === undefined || path === ".") {
        return { problem: `The entry point ${entryPoint.path} isn't a file in the repository.` };
      }
      return { command: { folder: checkout, argv: [`./${path}`, ...entryPoint.arguments] } };
    }
    case "package-script": {
      const manifest = repositoryPath(entryPoint.manifest);
      if (manifest === undefined || manifest === ".") {
        return { problem: `The manifest ${entryPoint.manifest} isn't a file in the repository.` };
      }
      const folder = posix.dirname(manifest);
      return {
        command: {
          folder: folder === "." ? checkout : posix.join(checkout, folder),
          argv: ["npm", "run", entryPoint.script, "--", ...entryPoint.arguments],
        },
      };
    }
    case "gradle-task":
      return {
        command: {
          folder: checkout,
          argv: ["./gradlew", entryPoint.task, ...entryPoint.arguments],
        },
      };
  }
}

/** The path from the repository's root with forward slashes, or none when it leads out of it. */
function repositoryPath(given: string): string | undefined {
  const path = posix.normalize(given.trim().replaceAll("\\", "/"));
  if (posix.isAbsolute(path) || path === ".." || path.startsWith("../")) return undefined;
  return path.replace(/\/+$/, "");
}

/**
 * The script an entry point runs as in the devcontainer's service: into its folder, then the
 * command given as the script's arguments, so nothing the repository names is read by a shell.
 */
export function entryPointScript(folder: string): string {
  return `cd ${quoted(folder)} || exit 125\nexec "$@"`;
}

/**
 * The script one of the Project's commands before the entry point runs as in the devcontainer's
 * service (spec §2.12, "Commands before the entry point"): in the checkout, each variable taken
 * from its carrier (`commandVariables` gives their values by name), the command line last, so its
 * exit code is the script's.
 */
export function commandBeforeScript(
  checkout: string,
  commandLine: string,
  environment: CommandEnvironment,
): string {
  return commandScript(commandLine, checkout, environment);
}

function checksServiceOverride(
  definition: RunEnvironmentDefinition,
  task: TaskInWorktree,
  image: string,
  deviceHelperFolder: string,
): Record<string, unknown> {
  return devcontainerServiceOverride(definition, task.worktree, image, [
    bindMount(task.worktree, false),
    ...(isInside(task.repositoryGitFolder, task.worktree)
      ? []
      : // Read-only: checks read the history, but every git change is The Office's (spec §5.5).
        [bindMount(task.repositoryGitFolder, true)]),
    // Read-only: The Office writes the file, condition commands only read it.
    bindMount(task.stageRunsFolder, true),
    deviceHelperMount(deviceHelperFolder),
  ]);
}

/**
 * The device helper's folder at DEVICE_HELPER_MOUNT: read-only, and no port published for it, as
 * only the service runs it (spec §2.13, "The relay").
 */
function deviceHelperMount(deviceHelperFolder: string): Record<string, unknown> {
  return { ...bindMount(deviceHelperFolder, true), target: DEVICE_HELPER_MOUNT };
}

/**
 * Where the checks' service sees The Office device helper's folder (spec §5.5, "The Office device
 * helper in a run environment"): one path whatever the Office data directory is.
 */
export const DEVICE_HELPER_MOUNT = "/office-device-helper";

/**
 * The devcontainer's service on the Project's image, with its mounts, working in `folder`; in the
 * image's own working folder when there is none, as a pairing environment mounts no checkout.
 */
function devcontainerServiceOverride(
  definition: RunEnvironmentDefinition,
  folder: string | undefined,
  image: string,
  volumes: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    image,
    // Built by The Office before the run environment starts; never pulled or built by compose.
    pull_policy: "never",
    volumes,
    ...(folder === undefined ? {} : { working_dir: composeLiteral(folder) }),
    ...(definition.overrideCommand
      ? {
          entrypoint: ["/bin/sh", "-c"],
          command: [composeLiteral("trap 'exit 0' TERM; while :; do sleep 3600 & wait $!; done")],
        }
      : {}),
  };
}

/** A host folder at the same path inside. */
function bindMount(folder: string, readOnly: boolean): Record<string, unknown> {
  const mount = { type: "bind", source: composeLiteral(folder), target: composeLiteral(folder) };
  return readOnly ? { ...mount, read_only: true } : mount;
}

/** Whether `folder` is `parent` or lies inside it; a main checkout's git folder does. */
function isInside(folder: string, parent: string): boolean {
  const fromParent = relative(parent, folder);
  return fromParent !== ".." && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent);
}

/** A value compose takes as it is: it reads `$` as the start of a variable, `$$` as a `$`. */
function composeLiteral(text: string): string {
  // A function, since "$$" in a replacement string means one "$".
  return text.replaceAll("$", () => "$$");
}

/**
 * The variable the Project's `set` variable at `index` is carried into the service under: the
 * runtime's CLI holds the value in its own environment, and a Project's name, such as PATH or
 * DOCKER_HOST, would change how the CLI itself runs.
 */
export function carrierOf(index: number): string {
  return `OFFICE_VARIABLE_${index}`;
}

/**
 * The values a check runs with, by their carriers (carrierOf), which the runtime gives by name
 * (`Execution.variables`), so no value is in the script or a command line.
 */
export function commandVariables(environment: CommandEnvironment): Record<string, string> {
  return Object.fromEntries(environment.set.map(({ value }, index) => [carrierOf(index), value]));
}

/** How a check's script is written beyond its command and environment. */
export interface CommandScriptOptions {
  /**
   * Whether git in the check trusts every repository, the worktree and the repository's git folder
   * among them: on a non-root Office they belong to another user than the check's (spec §5.5
   * Defaults, "Run environments with a non-root Office").
   */
  readonly trustRepositories: boolean;
}

/** The user and group, by number, a file is given to. */
export interface FileOwnerIds {
  readonly userId: number;
  readonly groupId: number;
}

/** Who a hand-back runs as in the checks' service: root, whatever user the image names. */
export const ROOT_USER = "0:0";

/** How long giving files back may take: a worktree's node_modules can be large. */
export const HAND_BACK_TIMEOUT_MS = 10 * 60 * 1000;

/** The ids `<uid>:<gid>` a container runtime reads for a user, as numbers. */
export function fileOwnerIdsOf(ids: string): FileOwnerIds {
  const [userId = "", groupId = ""] = ids.split(":");
  return { userId: Number(userId), groupId: Number(groupId) };
}

/**
 * The shell script a check runs as in the service: in the worktree, with the Project's environment
 * applied over the service's own, each `set` variable taken from its carrier, and the command line
 * last, so its exit code is the script's.
 */
export function commandScript(
  commandLine: string,
  folder: string,
  environment: CommandEnvironment,
  { trustRepositories }: CommandScriptOptions = { trustRepositories: false },
): string {
  const carriers = environment.set.map((_, index) => carrierOf(index));
  return [
    `cd ${quoted(folder)} || exit 125`,
    ...(environment.unset.length > 0 ? [`unset ${environment.unset.map(quoted).join(" ")}`] : []),
    ...environment.set.map(({ name }, index) => `export ${name}="$${carrierOf(index)}"`),
    ...(carriers.length > 0 ? [`unset ${carriers.join(" ")}`] : []),
    ...(environment.prependPath.length > 0
      ? [`export PATH=${quoted(environment.prependPath.join(":"))}:"$PATH"`]
      : []),
    ...(trustRepositories ? TRUST_REPOSITORIES_LINES : []),
    commandLine,
  ].join("\n");
}

/**
 * git's command-scope config (git 2.31 on), added to any the Project's environment already holds:
 * `safe.directory` given there is honoured from git 2.35.2, the versions that check ownership.
 */
const TRUST_REPOSITORIES_LINES: readonly string[] = [
  "office_n=${GIT_CONFIG_COUNT:-0}",
  `export "GIT_CONFIG_KEY_$office_n=safe.directory" "GIT_CONFIG_VALUE_$office_n=*"`,
  "export GIT_CONFIG_COUNT=$((office_n + 1))",
  "unset office_n",
];

/**
 * The shell script, run as root in the checks' service, that gives back to `owner` every file and
 * folder in the worktree another user or group owns. Only those, so git sees no tracked file's
 * ctime change; `-h` changes a symlink itself, never what it points to. Busybox and GNU find both
 * take numeric ids; an image with no find falls back to changing everything.
 */
export function handBackScript(worktree: string, { userId, groupId }: FileOwnerIds): string {
  const folder = quoted(worktree);
  const owner = `${userId}:${groupId}`;
  return (
    `if command -v find >/dev/null 2>&1; then ` +
    `find ${folder} \\( ! -user ${userId} -o ! -group ${groupId} \\) -exec chown -h ${owner} {} +; ` +
    `else chown -R -h ${owner} ${folder}; fi`
  );
}

function quoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
