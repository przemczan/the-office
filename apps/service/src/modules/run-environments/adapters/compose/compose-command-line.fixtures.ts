import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The budget of a test on the real container runtime: pulling a small image on first use, and
 * starting and removing compose projects, on a busy workstation.
 */
export const REAL_RUNTIME_TEST = { timeout: 300_000 } as const;

/** Why the real runtime's tests can't run here, or nothing when its daemon answers. */
export async function realRuntimeMissing(): Promise<string | undefined> {
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 20_000 });
    await run("docker", ["compose", "version"], { timeout: 20_000 });
    return undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return `no container runtime with compose answers here: ${reason}`;
  }
}

export interface ContainerLimits {
  readonly nanoCpus: number;
  readonly memoryBytes: number;
  readonly processes: number;
}

/** The limits the runtime holds a container to. */
export async function containerLimitsOf(container: string): Promise<ContainerLimits> {
  const { stdout } = await run("docker", [
    "container",
    "inspect",
    "--format",
    "{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}}",
    container,
  ]);
  const [nanoCpus, memoryBytes, processes] = stdout.trim().split(" ").map(Number);
  return { nanoCpus: nanoCpus ?? 0, memoryBytes: memoryBytes ?? 0, processes: processes ?? 0 };
}
