import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import type { RunEnvironmentDefinition } from "./run-environment-definition.js";

/** A variable the install command runs with while the image builds: the Project's `set`. */
export interface InstallVariable {
  readonly name: string;
  readonly value: string;
  /** A Secret variable, whose value is in no image layer and not in the key. */
  readonly secret: boolean;
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
 * The compose file The Office puts over the repository's: the image, the worktree, the git folder
 * and the Stage runs' folder on the checks' service, The Office's labels on every service, network
 * and volume, and the limits on every service. Compose takes a later file's values over an earlier
 * one's, so the definition can't undo any of it. No service gets `cpu_shares`: the runtime's
 * default weight is already equal, and an explicit 1024 would lower it under cgroup v2.
 */
export function composeOverrideOf(
  definition: RunEnvironmentDefinition,
  task: TaskInWorktree,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
  hostCores: number,
): Record<string, unknown> {
  const labels = { ...taskLabels(instance, task.taskId), [LABEL.project]: task.projectId };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        cpus: serviceCpusOf(limits.cpuLimit, hostCores, service === definition.service),
        mem_limit: `${limits.memoryMegabytes}m`,
        // No swap above the memory limit, so the limit holds.
        memswap_limit: `${limits.memoryMegabytes}m`,
        pids_limit: limits.processes,
        ...(service === definition.service ? checksServiceOverride(definition, task, image) : {}),
      },
    ]),
  );
  return {
    services,
    networks: Object.fromEntries(
      ["default", ...definition.networks].map((network) => [network, { labels }]),
    ),
    ...(definition.volumes.length > 0
      ? { volumes: Object.fromEntries(definition.volumes.map((volume) => [volume, { labels }])) }
      : {}),
  };
}

function checksServiceOverride(
  definition: RunEnvironmentDefinition,
  task: TaskInWorktree,
  image: string,
): Record<string, unknown> {
  return {
    image,
    // Built by The Office before the run environment starts; never pulled or built by compose.
    pull_policy: "never",
    volumes: [
      bindMount(task.worktree, false),
      ...(isInside(task.repositoryGitFolder, task.worktree)
        ? []
        : // Read-only: checks read the history, but every git change is The Office's (spec §5.5).
          [bindMount(task.repositoryGitFolder, true)]),
      // Read-only: The Office writes the file, condition commands only read it.
      bindMount(task.stageRunsFolder, true),
    ],
    working_dir: composeLiteral(task.worktree),
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
