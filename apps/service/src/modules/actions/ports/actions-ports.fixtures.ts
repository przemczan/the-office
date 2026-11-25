import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRunning, type ActionRun, type ActionRunUser } from "../domain/action-run.js";
import { ActionRunNotFound, ActionRunRefused } from "../domain/action-run-refused.js";
import { DEFAULT_ACTION_SETTINGS, type ActionSettings } from "../domain/action-settings.js";
import {
  ActionDevices,
  type ActionDevice,
  type ActionDeviceHold,
  type ActionDeviceHoldDisconnected,
  type ActionDeviceHoldRequest,
} from "./action-devices.js";
import {
  ActionProjects,
  type CommandRunSettings,
  type RunAction,
  type RunMask,
  type RunProject,
  type WorkstationRunEnd,
} from "./action-projects.js";
import {
  ActionRunningAlready,
  ActionRunRepository,
  type ActionRunChange,
} from "./action-run-repository.js";
import { ActionRunSignals } from "./action-run-signals.js";
import { ActionSettingsStore } from "./action-settings-store.js";
import { ActionSources, type SourceInitiative, type SourceTask } from "./action-sources.js";
import {
  ActionTestInstances,
  type RunTestInstance,
  type TestInstanceMove,
} from "./action-test-instances.js";
import { ActionWorkflowHost, type HostCiRun } from "./action-workflow-host.js";

/** The Action runs in memory, by the same rules as the table: one running run per Action. */
export class ActionRunRepositoryForTests extends ActionRunRepository {
  readonly runs = new Map<string, ActionRun>();

  add(run: ActionRun): Promise<void> {
    const running = [...this.runs.values()].some(
      (each) =>
        each.projectId === run.projectId && each.actionKey === run.actionKey && isRunning(each),
    );
    if (running && isRunning(run)) {
      return Promise.reject(new ActionRunningAlready(run.projectId, run.actionKey));
    }
    this.runs.set(run.id, run);
    return Promise.resolve();
  }

  find(id: string): Promise<ActionRun | undefined> {
    return Promise.resolve(this.runs.get(id));
  }

  listOfProject(projectId: string): Promise<readonly ActionRun[]> {
    return Promise.resolve(
      newestFirst([...this.runs.values()].filter((run) => run.projectId === projectId)),
    );
  }

  listOfAction(projectId: string, actionKey: string): Promise<readonly ActionRun[]> {
    return Promise.resolve(
      newestFirst(
        [...this.runs.values()].filter(
          (run) => run.projectId === projectId && run.actionKey === actionKey,
        ),
      ),
    );
  }

  running(): Promise<readonly ActionRun[]> {
    return Promise.resolve(newestFirst([...this.runs.values()].filter(isRunning)).toReversed());
  }

  ofTestInstance(instanceId: string): Promise<ActionRun | undefined> {
    return Promise.resolve(
      [...this.runs.values()].find((run) => run.testInstanceId === instanceId),
    );
  }

  update(
    id: string,
    change: ActionRunChange,
  ): Promise<{ before: ActionRun; after: ActionRun } | undefined> {
    const before = this.runs.get(id);
    if (before === undefined) return Promise.resolve(undefined);
    const after = change(before);
    if (after === undefined) return Promise.resolve(undefined);
    this.runs.set(id, after);
    return Promise.resolve({ before, after });
  }

  remove(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.runs.delete(id);
    return Promise.resolve();
  }
}

function newestFirst(runs: readonly ActionRun[]): ActionRun[] {
  return runs.toSorted((one, other) => other.startedAt.getTime() - one.startedAt.getTime());
}

export class ActionSettingsForTests extends ActionSettingsStore {
  settings: ActionSettings = DEFAULT_ACTION_SETTINGS;

  read(): Promise<ActionSettings> {
    return Promise.resolve(this.settings);
  }

  change(settings: ActionSettings): Promise<void> {
    this.settings = settings;
    return Promise.resolve();
  }
}

/** A Project command's command line, as a test's Project has it. */
export interface CommandForTests {
  readonly key: string;
  readonly name: string;
  readonly commandLine: string;
}

/** A Project as a test sets it up: its Actions, commands, targets, branches and Secret variable. */
export interface ProjectForTests {
  project: RunProject;
  actions: RunAction[];
  commands: CommandForTests[];
  targetKeys: string[];
  /** Each branch's tip, with the files a checkout of it gets. */
  branches: Record<string, { commit: string; subject: string; files: Record<string, string> }>;
  /** The branches the remote has. */
  remoteBranches: string[];
  secret?: { readonly name: string; readonly value: string };
}

/** Hides a test's Secret variable as `[secret NAME]`. */
export function maskOf(
  secret: { readonly name: string; readonly value: string } | undefined,
): RunMask {
  const mask = (text: string): string =>
    secret === undefined ? text : text.replaceAll(secret.value, `[secret ${secret.name}]`);
  return {
    mask,
    chunks: () => {
      // Whole chunks only: a test's output never cuts a secret in two.
      return {
        next: (chunk) => Buffer.from(mask(Buffer.from(chunk).toString("utf8"))),
        end: () => new Uint8Array(),
      };
    },
  };
}

/**
 * Projects in memory: the checkout writes the branch's files into `<folder>/<run id>/`, the log is
 * `<folder>/<run id>.log`, and a workstation run is `onWorkstation`'s, which writes into the log
 * through `print`.
 */
export class ActionProjectsForTests extends ActionProjects {
  readonly projects = new Map<string, ProjectForTests>();
  readonly checkedOut: string[] = [];
  readonly removedCheckouts: string[] = [];
  readonly workstationRuns: Parameters<ActionProjects["runOnWorkstation"]>[0][] = [];
  onWorkstation: (
    run: Parameters<ActionProjects["runOnWorkstation"]>[0],
    print: (text: string) => Promise<void>,
  ) => Promise<WorkstationRunEnd> = (run) =>
    Promise.resolve({
      name: run.commands[run.commands.length - 1]?.name ?? "",
      outcome: "passed",
      exitCode: 0,
    });

  constructor(readonly folder: string) {
    super();
  }

  put(project: ProjectForTests): void {
    this.projects.set(project.project.id, project);
  }

  of(projectId: string): ProjectForTests {
    const project = this.projects.get(projectId);
    if (project === undefined) throw ActionRunNotFound.project(projectId);
    return project;
  }

  projectOf(projectId: string): Promise<RunProject> {
    return Promise.resolve().then(() => this.of(projectId).project);
  }

  actionsOf(projectId: string): Promise<readonly RunAction[]> {
    return Promise.resolve().then(() => this.of(projectId).actions);
  }

  actionOf(projectId: string, key: string): Promise<RunAction | undefined> {
    return Promise.resolve().then(() =>
      this.of(projectId).actions.find((each) => each.key === key),
    );
  }

  commandRunOf(projectId: string, key: string): Promise<CommandRunSettings> {
    return Promise.resolve().then(() => {
      const project = this.of(projectId);
      const action = project.actions.find((each) => each.key === key);
      if (action?.kind !== "project-command")
        throw new ActionRunRefused(["No such command Action."]);
      const keys = [...action.settings.commandsBefore, action.settings.commandKey];
      const found = keys.map((each) => ({
        key: each,
        command: project.commands.find((command) => command.key === each),
      }));
      return {
        commands: found.flatMap(({ command }) =>
          command === undefined ? [] : [{ name: command.name, commandLine: command.commandLine }],
        ),
        missingCommands: found.flatMap(({ key: each, command }) =>
          command === undefined ? [each] : [],
        ),
        timeoutMs: (action.settings.timeLimitMinutes ?? 60) * 60_000,
        environment: {
          set: project.secret === undefined ? [] : [{ ...project.secret, secret: true }],
          unset: [],
          prependPath: [],
        },
        mask: maskOf(project.secret),
        install: { installCommand: "", installInputs: [], installVariables: [] },
      };
    });
  }

  hasTestTarget(projectId: string, key: string): Promise<boolean> {
    return Promise.resolve().then(() => this.of(projectId).targetKeys.includes(key));
  }

  branchTip(projectId: string, branch: string): Promise<{ commit: string; subject: string }> {
    return Promise.resolve().then(() => {
      const tip = this.of(projectId).branches[branch];
      if (tip === undefined) {
        throw new ActionRunRefused([`Neither the repository nor its remote has ${branch}.`]);
      }
      return { commit: tip.commit, subject: tip.subject };
    });
  }

  remoteHasBranch(projectId: string, branch: string): Promise<boolean> {
    return Promise.resolve().then(() => this.of(projectId).remoteBranches.includes(branch));
  }

  async checkOut(
    projectId: string,
    runId: string,
    branch: string,
    commit: string,
  ): Promise<string> {
    const tip = this.of(projectId).branches[branch];
    if (tip?.commit !== commit) throw new ActionRunRefused([`${branch} has no commit ${commit}.`]);
    const checkout = join(this.folder, runId);
    for (const [path, text] of Object.entries(tip.files)) {
      await mkdir(dirname(join(checkout, path)), { recursive: true });
      await writeFile(join(checkout, path), text);
    }
    this.checkedOut.push(runId);
    return checkout;
  }

  async removeCheckout(runId: string): Promise<void> {
    this.removedCheckouts.push(runId);
    await rm(join(this.folder, runId), { recursive: true, force: true });
  }

  logFileOf(runId: string): string {
    return join(this.folder, `${runId}.log`);
  }

  async removeLog(runId: string): Promise<void> {
    await rm(this.logFileOf(runId), { force: true });
  }

  async leftoverRunIds(): Promise<readonly string[]> {
    const entries = await readdir(this.folder, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory()).map(({ name }) => name);
  }

  runOnWorkstation(
    run: Parameters<ActionProjects["runOnWorkstation"]>[0],
  ): Promise<WorkstationRunEnd> {
    this.workstationRuns.push(run);
    const mask = maskOf(this.of(run.projectId).secret);
    return this.onWorkstation(run, async (text) => {
      await mkdir(this.folder, { recursive: true });
      const { appendFile } = await import("node:fs/promises");
      await appendFile(this.logFileOf(run.runId), mask.mask(text));
    });
  }
}

export class ActionSourcesForTests extends ActionSources {
  readonly tasks = new Map<string, SourceTask>();
  readonly initiatives = new Map<string, SourceInitiative>();
  alarmOn = false;

  taskOf(taskId: string): Promise<SourceTask | undefined> {
    return Promise.resolve(this.tasks.get(taskId));
  }

  initiativeOf(initiativeId: string): Promise<SourceInitiative | undefined> {
    return Promise.resolve(this.initiatives.get(initiativeId));
  }

  fireAlarmOn(): Promise<boolean> {
    return Promise.resolve(this.alarmOn);
  }
}

/**
 * Test instances in memory: a launch answers Building, `move` moves one as Test instances would
 * and tells the listener; `refusal` refuses the next launches in its words.
 */
export class ActionTestInstancesForTests extends ActionTestInstances {
  readonly instances = new Map<
    string,
    RunTestInstance & {
      readonly runAs: unknown;
      readonly by: ActionRunUser;
      readonly relayTab: string | undefined;
    }
  >();
  readonly logs = new Map<string, string>();
  refusal: string | undefined;
  private listener: ((move: TestInstanceMove) => void) | undefined;
  private made = 0;

  launch(
    _projectId: string,
    _branch: string,
    _targetKey: string,
    by: ActionRunUser,
    runAs: { readonly actionKey: string; readonly actionName: string },
    relayTab: string | undefined,
  ): Promise<RunTestInstance> {
    if (this.refusal !== undefined) return Promise.reject(new ActionRunRefused([this.refusal]));
    this.made += 1;
    const id = `00000000-0000-4000-8000-${String(this.made).padStart(12, "0")}`;
    const instance = {
      id,
      state: "building" as const,
      commit: undefined,
      failedReason: undefined,
      runAs,
      by,
      relayTab,
    };
    this.instances.set(id, instance);
    return Promise.resolve(instance);
  }

  read(id: string): Promise<RunTestInstance> {
    const instance = this.instances.get(id);
    if (instance === undefined) return Promise.reject(new ActionRunNotFound(`No instance ${id}.`));
    return Promise.resolve(instance);
  }

  stop(id: string): Promise<RunTestInstance> {
    const instance = this.instances.get(id);
    if (instance === undefined) return Promise.reject(new ActionRunNotFound(`No instance ${id}.`));
    if (!["building", "running", "installing"].includes(instance.state))
      return Promise.resolve(instance);
    // A Build to install instance stopped while Building is Failed, "Stopped by you."
    this.move(id, { state: "failed", failedReason: "Stopped by you.", stoppedByUser: true });
    return this.read(id);
  }

  /** Moves the instance and tells the listener, as Test instances' events do. */
  move(
    id: string,
    to: {
      state: RunTestInstance["state"];
      failedReason?: string;
      stoppedByUser?: boolean;
      commit?: string;
    },
  ): void {
    const instance = this.instances.get(id);
    if (instance === undefined) throw new Error(`No instance ${id}.`);
    this.instances.set(id, {
      ...instance,
      state: to.state,
      failedReason: to.failedReason,
      commit: to.commit ?? instance.commit,
    });
    if (to.commit !== undefined) this.listener?.({ instanceId: id, commit: to.commit });
    this.listener?.({
      instanceId: id,
      to: to.state,
      failedReason: to.failedReason,
      stoppedByUser: to.stoppedByUser === true,
    });
  }

  onMoved(listener: (move: TestInstanceMove) => void): void {
    this.listener = listener;
  }

  readLog(id: string, from: number): Promise<{ text: string; nextOffset: number }> {
    const text = (this.logs.get(id) ?? "").slice(from);
    return Promise.resolve({ text, nextOffset: from + Buffer.byteLength(text) });
  }
}

/**
 * A code host in memory: `start` is taken unless `refusal` is set; the run it makes shows once
 * `show` is called, and `ciRuns` holds each run's status as the host reports it now.
 */
export class ActionWorkflowHostForTests extends ActionWorkflowHost {
  readonly starts: {
    projectId: string;
    file: string;
    branch: string;
    inputs: Readonly<Record<string, string>>;
    askedAt: Date;
  }[] = [];
  readonly ciRuns = new Map<number, HostCiRun>();
  refusal: string | undefined;
  readonly shown: HostCiRun[] = [];

  constructor(private readonly now: () => Date) {
    super();
  }

  start(
    projectId: string,
    file: string,
    branch: string,
    inputs: Readonly<Record<string, string>>,
  ): Promise<{ hostName: string; askedAt: Date; runsUrl: string | undefined }> {
    if (this.refusal !== undefined) return Promise.reject(new ActionRunRefused([this.refusal]));
    const askedAt = this.now();
    this.starts.push({ projectId, file, branch, inputs, askedAt });
    return Promise.resolve({
      hostName: "GitHub",
      askedAt,
      runsUrl: `https://github.com/ann/shop/actions/workflows/${file}`,
    });
  }

  /** The code host shows a run started by hand, after those it shows already. */
  show(run: HostCiRun): void {
    this.shown.push(run);
    this.ciRuns.set(run.id, run);
  }

  runsStartedByHand(): Promise<readonly HostCiRun[]> {
    return Promise.resolve(this.shown.map((shown) => this.ciRuns.get(shown.id) ?? shown));
  }

  ciRunOf(_projectId: string, runId: number): Promise<HostCiRun | undefined> {
    return Promise.resolve(this.ciRuns.get(runId));
  }
}

/** The other modules' signals, given by hand. */
export class ActionRunSignalsForTests extends ActionRunSignals {
  alarmSoundedAsap: () => void = () => undefined;
  actionsSwitchedOff: (projectId: string) => void = () => undefined;
  actionsRemoved: (projectId: string, keys: readonly string[]) => void = () => undefined;

  onAlarmSoundedAsap(listener: () => void): void {
    this.alarmSoundedAsap = listener;
  }

  onActionsSwitchedOff(listener: (projectId: string) => void): void {
    this.actionsSwitchedOff = listener;
  }

  onActionsRemoved(listener: (projectId: string, keys: readonly string[]) => void): void {
    this.actionsRemoved = listener;
  }
}

/** A hold the Devices stand-in made, with how it ended. */
export interface HoldForTests {
  readonly holdId: string;
  readonly projectDeviceId: string;
  readonly actionRunId: string;
  readonly holderName: string;
  readonly relayTab: string | undefined;
  /** "run-ended" once the run let go of it, else why it ended from outside; undefined while open. */
  ended: string | undefined;
}

/**
 * Devices in memory: the Project's devices by id, each held by one run at a time; a hold answers
 * at once, held with `ANDROID_SERIAL`, or not held with `holdProblem`.
 */
export class ActionDevicesForTests extends ActionDevices {
  readonly devices = new Map<string, ActionDevice & { readonly projectId: string }>();
  /** Who holds each device from elsewhere, as Devices names them: a Task's title, a test instance. */
  readonly heldElsewhere = new Map<string, string>();
  readonly holds: HoldForTests[] = [];
  /** Why the next holds aren't made, as Devices words it; undefined to hold them. */
  holdProblem: string | undefined;
  private listener: ((hold: ActionDeviceHoldDisconnected) => void) | undefined;

  deviceOf(projectId: string, projectDeviceId: string): Promise<ActionDevice | undefined> {
    const device = this.devices.get(projectDeviceId);
    return Promise.resolve(
      device?.projectId === projectId ? { id: device.id, name: device.name } : undefined,
    );
  }

  checkFree(projectId: string, projectDeviceId: string): Promise<void> {
    const device = this.devices.get(projectDeviceId);
    if (device?.projectId !== projectId) {
      return Promise.reject(
        new ActionRunRefused(["The device isn't one of this Project's devices."]),
      );
    }
    const holder = this.holderOf(projectDeviceId);
    if (holder !== undefined) {
      return Promise.reject(new ActionRunRefused([`${device.name} is in use by ${holder}.`]));
    }
    return Promise.resolve();
  }

  async hold(request: ActionDeviceHoldRequest): Promise<ActionDeviceHold> {
    await this.checkFree(request.projectId, request.projectDeviceId);
    const hold: HoldForTests = {
      holdId: `hold-${this.holds.length + 1}`,
      projectDeviceId: request.projectDeviceId,
      actionRunId: request.actionRunId,
      holderName: request.holderName,
      relayTab: request.relayTab,
      ended: undefined,
    };
    this.holds.push(hold);
    if (this.holdProblem !== undefined) {
      this.ended(hold, "device-unplugged");
      return { held: false, problem: this.holdProblem };
    }
    return {
      held: true,
      holdId: hold.holdId,
      variables: [
        { name: "OFFICE_CONNECTED_DEVICES", value: `[{"id":"${hold.holdId}"}]` },
        { name: "ANDROID_SERIAL", value: "127.0.0.1:41234" },
      ],
    };
  }

  letGo(holdId: string): Promise<void> {
    const hold = this.holds.find((each) => each.holdId === holdId);
    if (hold !== undefined && hold.ended === undefined) this.ended(hold, "run-ended");
    return Promise.resolve();
  }

  /** Ends the hold as Devices does from outside, such as Run environment turned Off. */
  endFromOutside(holdId: string, because: string): void {
    const hold = this.holds.find((each) => each.holdId === holdId);
    if (hold === undefined || hold.ended !== undefined) throw new Error(`No open hold ${holdId}.`);
    this.ended(hold, because);
  }

  onHoldDisconnected(listener: (hold: ActionDeviceHoldDisconnected) => void): void {
    this.listener = listener;
  }

  endedFromOutside(holdId: string): Promise<string | undefined> {
    const ended = this.holds.find((each) => each.holdId === holdId)?.ended;
    return Promise.resolve(ended === "run-ended" ? undefined : ended);
  }

  private holderOf(projectDeviceId: string): string | undefined {
    return (
      this.heldElsewhere.get(projectDeviceId) ??
      this.holds.find(
        (each) => each.projectDeviceId === projectDeviceId && each.ended === undefined,
      )?.holderName
    );
  }

  private ended(hold: HoldForTests, because: string): void {
    hold.ended = because;
    this.listener?.({ actionRunId: hold.actionRunId, holdId: hold.holdId });
  }
}
