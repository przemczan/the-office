import { createHash } from "node:crypto";
import type { RunEnvironmentDefinition } from "./run-environment-definition.js";

/** A Task whose checks run in a run environment, and what its image is made from. */
export interface TaskInWorktree {
  readonly taskId: string;
  /** For what The Office is busy with, in the UI's words. */
  readonly taskTitle: string;
  readonly projectId: string;
  /** The Task's worktree, an absolute path: mounted at the same path inside (spec §5.5). */
  readonly worktree: string;
  readonly installCommand: string | undefined;
  /** The Project's Install inputs, relative to the worktree. */
  readonly installInputs: readonly string[];
}

/** How a check changes the variables it runs with: the Project's environment (spec §5.5). */
export interface CommandEnvironment {
  readonly set: readonly { readonly name: string; readonly value: string }[];
  readonly unset: readonly string[];
  readonly prependPath: readonly string[];
}

/** Each run environment's limits, set Office-wide (spec §5.5, "Limits"). */
export interface RunEnvironmentLimits {
  readonly cpus: number;
  readonly memoryMegabytes: number;
  readonly processes: number;
}

/** The Office-wide settings of run environments. */
export interface RunEnvironmentOptions {
  readonly limits: RunEnvironmentLimits;
  /** Run environments at once: how many may be running together. */
  readonly runEnvironmentsAtOnce: number;
}

/** The spec's defaults, until Settings changes them. */
export const DEFAULT_RUN_ENVIRONMENT_OPTIONS: RunEnvironmentOptions = {
  limits: { cpus: 2, memoryMegabytes: 4096, processes: 1024 },
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
 * The compose file The Office puts over the repository's: the image and the worktree on the
 * checks' service, The Office's labels on every service, network and volume, and the limits on
 * every service. Compose takes a later file's values over an earlier one's, so the definition can't
 * undo any of it.
 */
export function composeOverrideOf(
  definition: RunEnvironmentDefinition,
  task: TaskInWorktree,
  image: string,
  instance: string,
  limits: RunEnvironmentLimits,
): Record<string, unknown> {
  const labels = { ...taskLabels(instance, task.taskId), [LABEL.project]: task.projectId };
  const services = Object.fromEntries(
    definition.services.map((service) => [
      service,
      {
        labels,
        cpus: limits.cpus,
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
      {
        type: "bind",
        source: composeLiteral(task.worktree),
        target: composeLiteral(task.worktree),
      },
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

/** A value compose takes as it is: it reads `$` as the start of a variable, `$$` as a `$`. */
function composeLiteral(text: string): string {
  // A function, since "$$" in a replacement string means one "$".
  return text.replaceAll("$", () => "$$");
}

/**
 * The shell script a check runs as in the service: in the worktree, with the Project's environment
 * applied over the service's own, and the command line last, so its exit code is the script's.
 */
export function commandScript(
  commandLine: string,
  folder: string,
  environment: CommandEnvironment,
): string {
  return [
    `cd ${quoted(folder)} || exit 125`,
    ...(environment.unset.length > 0 ? [`unset ${environment.unset.map(quoted).join(" ")}`] : []),
    ...environment.set.map(({ name, value }) => `export ${name}=${quoted(value)}`),
    ...(environment.prependPath.length > 0
      ? [`export PATH=${quoted(environment.prependPath.join(":"))}:"$PATH"`]
      : []),
    commandLine,
  ].join("\n");
}

function quoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
