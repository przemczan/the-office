import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { BusyWork } from "../../office-updates/index.js";
import type {
  FileOwnerIds,
  RunEnvironmentOptions,
  TaskInWorktree,
} from "../domain/run-environment.js";
import type { ContainerRuntime } from "../ports/container-runtime.js";
import { KnownTasks, type KnownTask } from "../ports/known-tasks.js";
import { RunEnvironmentSettingsForTests } from "../ports/run-environment-settings.fixtures.js";
import { HostCores } from "./host-cores.js";
import {
  HostedServiceReadiness,
  type HostedServiceReadinessOptions,
} from "./hosted-service-readiness.js";
import { HostedServices } from "./hosted-services.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";
import { RunEnvironmentImages } from "./run-environment-images.js";
import { RunEnvironmentSlots } from "./run-environment-slots.js";
import { RunEnvironments } from "./run-environments.js";
import { ServiceOwner } from "./service-owner.js";

/** The Tasks the sweep weighs, as a test lists them. */
export class KnownTasksForTests extends KnownTasks {
  tasks: KnownTask[] = [];

  list(): Promise<readonly KnownTask[]> {
    return Promise.resolve(this.tasks);
  }

  read(id: string): Promise<KnownTask> {
    const task = this.tasks.find((known) => known.id === id);
    return task ? Promise.resolve(task) : Promise.reject(new Error(`No Task ${id}.`));
  }
}

/** The cores the testbed's computer has, whatever machine runs the test. */
const TESTBED_HOST_CORES = 4;

/** RunEnvironments wired by hand on the runtime given, in an Office data directory of its own. */
export interface RunEnvironmentsTestbed {
  readonly environments: RunEnvironments;
  /** Hosted Test instances on the same runtime, images, folders and settings. */
  readonly hostedServices: HostedServices;
  readonly folders: RunEnvironmentFolders;
  readonly settings: RunEnvironmentSettingsForTests;
  readonly knownTasks: KnownTasksForTests;
  readonly schedule: ManualSchedule;
  readonly busyWork: BusyWork;
  readonly events: EventBus;
  /** A temp folder for the test's worktrees. */
  readonly folder: string;
}

export async function runEnvironmentsTestbed(
  runtime: ContainerRuntime,
  options?: RunEnvironmentOptions,
  /** The non-root Office's user and group the checks' files go back to; none is a root Office. */
  serviceOwner?: FileOwnerIds,
  /** How a Hosted Test instance's app is tried; a TCP connect for up to 120 s unless given. */
  readiness?: HostedServiceReadinessOptions,
): Promise<RunEnvironmentsTestbed> {
  const folder = await mkdtemp(join(tmpdir(), "office-run-environments-"));
  const events = new EventBus();
  const folders = new RunEnvironmentFolders(new OfficeDataDirectory(join(folder, "office-data")));
  const settings = new RunEnvironmentSettingsForTests(options);
  const knownTasks = new KnownTasksForTests();
  const schedule = new ManualSchedule();
  const busyWork = new BusyWork(events);
  const images = new RunEnvironmentImages(runtime, folders, events);
  const hostCores = new HostCores(TESTBED_HOST_CORES);
  const environments = new RunEnvironments(
    runtime,
    images,
    new RunEnvironmentSlots(settings),
    folders,
    knownTasks,
    settings,
    hostCores,
    new ServiceOwner(serviceOwner),
    schedule,
    busyWork,
    events,
  );
  await environments.onModuleInit();
  const hostedServices = new HostedServices(
    runtime,
    images,
    folders,
    settings,
    hostCores,
    new HostedServiceReadiness(readiness),
  );
  return {
    environments,
    hostedServices,
    folders,
    settings,
    knownTasks,
    schedule,
    busyWork,
    events,
    folder,
  };
}

/** Writes the files, by their paths in the worktree, making the folders they need. */
export async function writeFiles(
  worktree: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(worktree, path)), { recursive: true });
    await writeFile(join(worktree, path), content);
  }
}

/** A Task in a worktree of its own in the testbed's folder, with npm's install inputs. */
export function taskIn(
  testbed: Pick<RunEnvironmentsTestbed, "folder">,
  taskId: string,
  worktree = join(testbed.folder, "worktrees", taskId),
): TaskInWorktree {
  return {
    taskId,
    taskTitle: `Task ${taskId}`,
    projectId: "shop",
    worktree,
    // A main checkout's, inside the worktree: no second mount, whose missing source a real
    // runtime would refuse.
    repositoryGitFolder: join(worktree, ".git"),
    stageRunsFolder: join(testbed.folder, "stage-runs", taskId),
    installCommand: "echo installed",
    installInputs: ["package-lock.json"],
    installVariables: [],
  };
}
