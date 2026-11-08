import { programName } from "./shell-commands.js";

/**
 * The programs that drive a container runtime. Reaching the runtime is reaching the workstation as
 * root, past every folder rule, so Agents never do (docs/container-runtime.md).
 */
export const CONTAINER_RUNTIME_PROGRAMS: readonly string[] = [
  "docker",
  "docker-compose",
  "podman",
  "podman-compose",
  "nerdctl",
];

/**
 * The Office tool an Agent Stage runs the Project's commands with, in the Task's run environment
 * when the Project has one on, which the runtime's refusal points to. Pipelines registers it.
 */
export const RUN_PROJECT_COMMAND_TOOL = "run_project_command";

/** The variables that point a runtime's client at a daemon, which a session never carries. */
export const CONTAINER_RUNTIME_VARIABLES: readonly string[] = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "CONTAINER_HOST",
];

/** A session's variables without those pointing at a runtime's daemon. */
export function withoutContainerRuntimeVariables(
  environment: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !CONTAINER_RUNTIME_VARIABLES.includes(name.toUpperCase()),
    ),
  );
}

/** The runtimes' sockets, named by any word: `curl --unix-socket /var/run/docker.sock` reaches the daemon too. */
const RUNTIME_SOCKET = /(docker|podman|containerd)\.sock/i;

/** A word that sets one of the variables: `DOCKER_HOST=…` before a program, after `export` or `env`. */
const RUNTIME_VARIABLE_SET = new RegExp(`^(${CONTAINER_RUNTIME_VARIABLES.join("|")})\\+?=`);

/**
 * How a command reaches the container runtime, in a few words, or undefined when it doesn't: the
 * program it runs (`programWords`), a word naming a runtime's socket, or one setting its variables.
 */
export function containerRuntimeReach(
  programWords: readonly string[],
  words: readonly string[],
): string | undefined {
  const program = programName(programWords[0] ?? "");
  if (CONTAINER_RUNTIME_PROGRAMS.includes(program)) return program;
  for (const word of words) {
    const socket = RUNTIME_SOCKET.exec(word);
    if (socket !== null) return socket[0];
    const variable = RUNTIME_VARIABLE_SET.exec(word);
    if (variable !== null) return variable[1];
  }
  return undefined;
}
