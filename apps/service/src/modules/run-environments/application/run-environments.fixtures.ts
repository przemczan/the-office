import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { BusyWork } from "../../office-updates/index.js";
import type { RunEnvironmentOptions, TaskInWorktree } from "../domain/run-environment.js";
import type { ContainerRuntime } from "../ports/container-runtime.js";
import { KnownTasks, type KnownTask } from "../ports/known-tasks.js";
import { RunEnvironmentSettingsForTests } from "../ports/run-environment-settings.fixtures.js";
import { RunEnvironmentFolders } from "./run-environment-folders.js";
import { RunEnvironmentImages } from "./run-environment-images.js";
import { RunEnvironmentSlots } from "./run-environment-slots.js";
import { RunEnvironments } from "./run-environments.js";

/** The Tasks the sweep weighs, as a test lists them. */
export class KnownTasksForTests extends KnownTasks {
  tasks: KnownTask[] = [];

  list(): Promise<readonly KnownTask[]> {
    return Promise.resolve(this.tasks);
  }
}

/** RunEnvironments wired by hand on the runtime given, in an Office data directory of its own. */
export interface RunEnvironmentsTestbed {
  readonly environments: RunEnvironments;
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
): Promise<RunEnvironmentsTestbed> {
  const folder = await mkdtemp(join(tmpdir(), "office-run-environments-"));
  const events = new EventBus();
  const folders = new RunEnvironmentFolders(new OfficeDataDirectory(join(folder, "office-data")));
  const settings = new RunEnvironmentSettingsForTests(options);
  const knownTasks = new KnownTasksForTests();
  const schedule = new ManualSchedule();
  const busyWork = new BusyWork(events);
  const environments = new RunEnvironments(
    runtime,
    new RunEnvironmentImages(runtime, folders, events),
    new RunEnvironmentSlots(settings),
    folders,
    knownTasks,
    settings,
    schedule,
    busyWork,
    events,
  );
  environments.onModuleInit();
  return { environments, folders, settings, knownTasks, schedule, busyWork, events, folder };
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
    installCommand: "echo installed",
    installInputs: ["package-lock.json"],
  };
}
