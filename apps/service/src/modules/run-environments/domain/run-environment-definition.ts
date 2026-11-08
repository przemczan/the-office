import { posix } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseJsonc } from "./jsonc.js";

/** The repository's Run environment definition, a folder at its top level (spec §5.5). */
export const DEFINITION_FOLDER = ".devcontainer";
export const DEFINITION_FILE = `${DEFINITION_FOLDER}/devcontainer.json`;

/** How the image of the service the checks run in is made, paths relative to the worktree. */
export type ServiceImage =
  | { readonly kind: "image"; readonly image: string }
  | {
      readonly kind: "build";
      readonly context: string;
      /** Relative to the context, as Docker reads it. */
      readonly dockerfile: string;
      readonly args: Readonly<Record<string, string>>;
      readonly target?: string;
    };

/** What The Office reads from the Run environment definition to build and start one. */
export interface RunEnvironmentDefinition {
  /** The compose files, relative to the worktree, in the order compose merges them. */
  readonly composeFiles: readonly string[];
  /** The service the checks run in. */
  readonly service: string;
  readonly serviceImage: ServiceImage;
  /** Every service of the compose files, the checks' own among them. */
  readonly services: readonly string[];
  /** The services started; every one when devcontainer.json names none. */
  readonly runServices: readonly string[];
  /** The networks and volumes the compose files declare. */
  readonly networks: readonly string[];
  readonly volumes: readonly string[];
  /** Who the checks run as in the service: devcontainer.json's remoteUser, else the image's. */
  readonly user?: string;
  /**
   * Whether The Office keeps the service running with a command of its own, as devcontainer.json's
   * overrideCommand says; the service's own command runs when it is false.
   */
  readonly overrideCommand: boolean;
}

/** What devcontainer.json says, before the compose files it names are read. */
export interface DevcontainerSettings {
  readonly composeFiles: readonly string[];
  readonly service: string;
  readonly runServices?: readonly string[];
  readonly user?: string;
  readonly overrideCommand: boolean;
}

/** A compose file devcontainer.json names, with its text, or none when it isn't there. */
export interface ComposeFileText {
  readonly path: string;
  readonly text: string | undefined;
}

export interface Reading<Value> {
  readonly value?: Value;
  /** Every problem found, in the UI's words; the value is there only when there are none. */
  readonly problems: readonly string[];
}

/** A file's text by its path in the repository; undefined when no such file is there. */
export type DefinitionFileText = (path: string) => Promise<string | undefined>;

/** The definition as read, and whether devcontainer.json was there at all. */
export interface DefinitionReading {
  readonly found: boolean;
  readonly reading: Reading<RunEnvironmentDefinition>;
}

/** How a repository's definition stands, as the Project page shows it. */
export type DefinitionStatus =
  | { readonly state: "not-found" }
  | { readonly state: "valid" }
  | { readonly state: "not-valid"; readonly problems: readonly string[] };

export function definitionStatusOf({ found, reading }: DefinitionReading): DefinitionStatus {
  if (!found) return { state: "not-found" };
  return reading.value === undefined
    ? { state: "not-valid", problems: reading.problems }
    : { state: "valid" };
}

/** Every reason the definition can't be used; empty when it is valid. */
export function definitionProblemsOf(status: DefinitionStatus): readonly string[] {
  switch (status.state) {
    case "valid":
      return [];
    case "not-found":
      return [`The repository has no ${DEFINITION_FILE}.`];
    case "not-valid":
      return status.problems;
  }
}

/**
 * devcontainer.json's properties The Office reads or may leave aside. Any other is refused, since
 * the definition would then not mean what it says: features, lifecycle commands, mounts and so on
 * need the devcontainer CLI, which The Office doesn't run.
 */
const DEVCONTAINER_PROPERTIES = new Set([
  "$schema",
  "name",
  "dockerComposeFile",
  "service",
  "runServices",
  "workspaceFolder",
  "overrideCommand",
  "shutdownAction",
  "remoteUser",
  "containerUser",
  "customizations",
]);

/** What a service may not set, since it would reach outside its run environment or share it. */
const SHARED_SERVICE_PROPERTIES: Readonly<Record<string, string>> = {
  container_name: "a fixed container name, which two Tasks' run environments can't both have",
  ports: "ports published on this computer, which two Tasks' run environments can't both have",
  network_mode: "a network mode, while each run environment has its own network",
  pid: "the process namespace of something outside the run environment",
  ipc: "an IPC namespace, which run environments don't share",
  privileged: "privileged mode, which gives it the whole computer",
  cap_add: "added capabilities",
  devices: "devices of this computer",
  userns_mode: "a user namespace mode",
  cgroup_parent: "a control group of its own",
  security_opt: "security options",
  volumes_from: "another container's volumes",
  extra_hosts: "addresses of this computer's network",
};

/** The limits The Office sets on every service (spec §5.5): a definition can't set its own. */
const LIMIT_PROPERTIES = [
  "deploy",
  "cpus",
  "cpu_count",
  "cpu_percent",
  "cpu_quota",
  "cpu_period",
  "cpu_shares",
  "cpuset",
  "mem_limit",
  "memswap_limit",
  "mem_reservation",
  "pids_limit",
];

const BUILD_PROPERTIES = new Set(["context", "dockerfile", "args", "target"]);

/** Reads devcontainer.json's text; `undefined` when the file isn't there. */
export function readDevcontainer(text: string | undefined): Reading<DevcontainerSettings> {
  if (text === undefined) {
    return { problems: [`The repository has no ${DEFINITION_FILE}.`] };
  }
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { problems: [`devcontainer.json isn't valid JSON: ${reason}`] };
  }
  if (!isRecord(parsed)) return { problems: ["devcontainer.json must hold one JSON object."] };

  const problems: string[] = [];
  for (const property of Object.keys(parsed)) {
    if (!DEVCONTAINER_PROPERTIES.has(property)) {
      problems.push(`devcontainer.json sets "${property}", which The Office doesn't support.`);
    }
  }
  const composeFiles = stringList(parsed["dockerComposeFile"]);
  if (composeFiles === undefined || composeFiles.length === 0) {
    problems.push(
      'devcontainer.json names no compose file: set "dockerComposeFile" to the compose file of the services the checks need.',
    );
  }
  const service = parsed["service"];
  if (typeof service !== "string" || service.trim() === "") {
    problems.push(
      'devcontainer.json names no service: set "service" to the one the checks run in.',
    );
  }
  const runServices = parsed["runServices"];
  if (runServices !== undefined && stringList(runServices) === undefined) {
    problems.push('devcontainer.json\'s "runServices" must be a list of service names.');
  }
  const overrideCommand = parsed["overrideCommand"];
  if (overrideCommand !== undefined && typeof overrideCommand !== "boolean") {
    problems.push('devcontainer.json\'s "overrideCommand" must be true or false.');
  }
  const user = parsed["remoteUser"] ?? parsed["containerUser"];
  if (user !== undefined && typeof user !== "string") {
    problems.push('devcontainer.json\'s "remoteUser" must be a user name.');
  }
  if (problems.length > 0 || composeFiles === undefined || typeof service !== "string") {
    return { problems };
  }
  const outsideRepository = composeFiles.filter((file) => outsideWorktree(definitionPath(file)));
  if (outsideRepository.length > 0) {
    return {
      problems: outsideRepository.map(
        (file) => `The compose file ${file} is outside the repository.`,
      ),
    };
  }
  return {
    value: {
      composeFiles: composeFiles.map(definitionPath),
      service,
      ...(runServices === undefined ? {} : { runServices: stringList(runServices) ?? [] }),
      ...(typeof user === "string" ? { user } : {}),
      // devcontainer.json's own default for a compose definition.
      overrideCommand: overrideCommand === true,
    },
    problems: [],
  };
}

/** Reads the compose files devcontainer.json names, in its order, into the whole definition. */
export function readDefinition(
  devcontainer: DevcontainerSettings,
  composeFiles: readonly ComposeFileText[],
): Reading<RunEnvironmentDefinition> {
  const problems: string[] = [];
  const services = new Map<string, Record<string, unknown>>();
  const serviceFolders = new Map<string, string>();
  const networks = new Set<string>();
  const volumes = new Set<string>();

  for (const { path, text } of composeFiles) {
    if (text === undefined) {
      problems.push(`The compose file ${path} isn't there.`);
      continue;
    }
    const compose = parseCompose(path, text, problems);
    if (compose === undefined) continue;
    const declaredServices = compose["services"];
    if (declaredServices !== undefined && !isRecord(declaredServices)) {
      problems.push(`The compose file ${path} must list its services by name.`);
      continue;
    }
    for (const [name, service] of Object.entries(declaredServices ?? {})) {
      if (!isRecord(service)) {
        problems.push(`The service ${name} in ${path} must be a mapping.`);
        continue;
      }
      services.set(name, { ...services.get(name), ...service });
      if (service["build"] !== undefined) serviceFolders.set(name, posix.dirname(path));
      problems.push(...serviceProblems(name, path, service));
    }
    collectDeclared("network", path, compose["networks"], networks, problems);
    collectDeclared("volume", path, compose["volumes"], volumes, problems);
  }
  if (problems.length > 0) return { problems };

  const main = services.get(devcontainer.service);
  if (main === undefined) {
    return {
      problems: [
        `The service ${devcontainer.service} that devcontainer.json names isn't in ${devcontainer.composeFiles.join(", ")}.`,
      ],
    };
  }
  const missingRunServices = (devcontainer.runServices ?? []).filter((name) => !services.has(name));
  if (missingRunServices.length > 0) {
    return {
      problems: missingRunServices.map(
        (name) => `The service ${name} in "runServices" isn't in the compose files.`,
      ),
    };
  }
  const serviceImage = serviceImageOf(
    devcontainer.service,
    main,
    serviceFolders.get(devcontainer.service) ?? DEFINITION_FOLDER,
  );
  if (!("kind" in serviceImage)) return { problems: serviceImage.problems };

  return {
    value: {
      composeFiles: devcontainer.composeFiles,
      service: devcontainer.service,
      serviceImage,
      services: [...services.keys()],
      runServices:
        devcontainer.runServices === undefined
          ? [...services.keys()]
          : [...new Set([...devcontainer.runServices, devcontainer.service])],
      networks: [...networks],
      volumes: [...volumes],
      ...(devcontainer.user === undefined ? {} : { user: devcontainer.user }),
      overrideCommand: devcontainer.overrideCommand,
    },
    problems: [],
  };
}

function parseCompose(
  path: string,
  text: string,
  problems: string[],
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    problems.push(`The compose file ${path} isn't valid YAML: ${reason}`);
    return undefined;
  }
  if (!isRecord(parsed)) {
    problems.push(`The compose file ${path} must be a mapping with its services.`);
    return undefined;
  }
  return parsed;
}

function serviceProblems(name: string, path: string, service: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [property, why] of Object.entries(SHARED_SERVICE_PROPERTIES)) {
    if (service[property] !== undefined) {
      problems.push(`The service ${name} in ${path} sets "${property}": ${why}.`);
    }
  }
  for (const property of LIMIT_PROPERTIES) {
    if (service[property] !== undefined) {
      problems.push(
        `The service ${name} in ${path} sets "${property}": The Office sets every service's limits.`,
      );
    }
  }
  const volumes = service["volumes"];
  if (Array.isArray(volumes) && volumes.some(isFolderMount)) {
    problems.push(
      `The service ${name} in ${path} mounts a folder of this computer: The Office mounts the worktree itself, so use named volumes only.`,
    );
  }
  return problems;
}

/** A bind mount, in the short syntax (a path before the colon) or the long one. */
function isFolderMount(volume: unknown): boolean {
  if (typeof volume === "string") {
    const [source, target] = volume.split(":");
    return target !== undefined && /^[./~]/.test(source ?? "");
  }
  return isRecord(volume) && volume["type"] === "bind";
}

function collectDeclared(
  kind: "network" | "volume",
  path: string,
  declared: unknown,
  names: Set<string>,
  problems: string[],
): void {
  if (declared === undefined || declared === null) return;
  if (!isRecord(declared)) {
    problems.push(`The compose file ${path} must list its ${kind}s by name.`);
    return;
  }
  for (const [name, settings] of Object.entries(declared)) {
    if (
      isRecord(settings) &&
      settings["external"] !== undefined &&
      settings["external"] !== false
    ) {
      problems.push(
        `The ${kind} ${name} in ${path} is external: each run environment has its own ${kind}s.`,
      );
    }
    names.add(name);
  }
}

function serviceImageOf(
  name: string,
  service: Record<string, unknown>,
  composeFolder: string,
): ServiceImage | { readonly problems: readonly string[] } {
  const build = service["build"];
  if (build === undefined) {
    const image = service["image"];
    if (typeof image === "string" && image.trim() !== "") return { kind: "image", image };
    return { problems: [`The service ${name} has neither an image nor a build.`] };
  }
  if (typeof build === "string") {
    return {
      kind: "build",
      context: posix.join(composeFolder, build),
      dockerfile: "Dockerfile",
      args: {},
    };
  }
  if (!isRecord(build)) return { problems: [`The service ${name}'s build must be a folder.`] };
  const problems = Object.keys(build)
    .filter((property) => !BUILD_PROPERTIES.has(property))
    .map(
      (property) =>
        `The service ${name}'s build sets "${property}", which The Office doesn't support.`,
    );
  const args = argumentsOf(build["args"]);
  if (args === undefined)
    problems.push(`The service ${name}'s build args must be names and values.`);
  const context = posix.join(composeFolder, stringOr(build["context"], "."));
  if (outsideWorktree(context)) {
    problems.push(`The service ${name}'s build context is outside the repository.`);
  }
  if (problems.length > 0 || args === undefined) return { problems };
  const target = build["target"];
  return {
    kind: "build",
    context,
    dockerfile: stringOr(build["dockerfile"], "Dockerfile"),
    args,
    ...(typeof target === "string" ? { target } : {}),
  };
}

/** Compose's build args, as a mapping or a list of `NAME=value`. */
function argumentsOf(args: unknown): Readonly<Record<string, string>> | undefined {
  if (args === undefined) return {};
  if (Array.isArray(args)) {
    const entries = args.map((each) =>
      typeof each === "string"
        ? ([each.split("=")[0] ?? "", each.slice(each.indexOf("=") + 1)] as const)
        : undefined,
    );
    if (entries.some((entry) => entry === undefined)) return undefined;
    return Object.fromEntries(entries.filter((entry) => entry !== undefined));
  }
  if (!isRecord(args)) return undefined;
  const entries = Object.entries(args);
  if (entries.some(([, value]) => typeof value === "object" && value !== null)) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value ?? "")]));
}

/** A path devcontainer.json names, relative to the worktree. */
function definitionPath(file: string): string {
  return posix.normalize(posix.join(DEFINITION_FOLDER, file.replaceAll("\\", "/")));
}

function outsideWorktree(path: string): boolean {
  return posix.isAbsolute(path) || path === ".." || path.startsWith("../");
}

function stringList(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((each) => typeof each === "string")) return value;
  return undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
