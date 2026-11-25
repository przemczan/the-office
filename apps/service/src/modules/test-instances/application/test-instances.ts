import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { ProjectFeaturesChanged } from "../../projects/index.js";
import {
  HostedServices,
  RunEnvironmentRefused,
  type TestInstallEnvironment,
} from "../../run-environments/index.js";
import { InitiativeStateChanged } from "../../work/index.js";
import {
  BY_RESTART,
  BY_TEST_TARGETS_OFF,
  BY_USER,
  INITIATIVE_NOT_ACTIVE,
  missingCommands,
  noInitiativeBranch,
  notLaunchable,
  RESTARTED_WHILE_BUILDING,
  RESTARTED_WHILE_INSTALLING,
  RUN_ENVIRONMENT_OFF,
  RUN_ENVIRONMENT_OFF_FOR_INSTALL,
  secretsWithoutValue,
  stopWords,
  type StopReason,
} from "../domain/stop-reason.js";
import {
  TestInstanceCommitRecorded,
  TestInstanceLaunched,
  type TestInstanceStateChanged,
} from "../domain/test-instance-events.js";
import { TestInstanceNotFound, TestInstanceRefused } from "../domain/test-instance-refused.js";
import {
  everyPortInUse,
  freeProxyPort,
  overTheLimit,
  type ActiveInstanceName,
} from "../domain/test-instance-settings.js";
import {
  BUILD_TIMEOUT_MS,
  buildFailureOf,
  commandBeforeFailureOf,
  hasFile,
  TEST_INSTANCE_MARK,
  type BuildEnd,
} from "../domain/test-build.js";
import {
  adbInstallArguments,
  apksOf,
  buildFailed,
  buildingWords,
  buildTargetGone,
  deviceLetGo,
  holderNameOf,
  ignoredWords,
  INSTALL_RAN_OUT,
  INSTALL_TIMEOUT_MS,
  installFailureOf,
  NO_APK,
  reusingWords,
} from "../domain/device-install.js";
import {
  built,
  countedTowardTheLimit,
  failed,
  installed,
  isActive,
  launchedInstance,
  startedInstalling,
  startedRunning,
  stopped,
  withBuild,
  withCommit,
  type LaunchedBy,
  type TestInstance,
  type TestInstanceDeviceKind,
  type TestInstanceRunAs,
  type TestInstanceKind,
  type TestInstanceState,
} from "../domain/test-instance.js";
import {
  DEVCONTAINER_SERVICE_BUILDS_NOTHING,
  workstationBuildCommandOf,
  type TargetEntryPoint,
} from "../domain/entry-point.js";
import { Initiatives } from "../ports/initiatives.js";
import { InstallDevices } from "../ports/install-devices.js";
import {
  ProjectTestTargets,
  type InstallLaunch,
  type InstanceMask,
  type ListedInstall,
  type TargetLaunch,
} from "../ports/project-test-targets.js";
import { TestInstanceRepository } from "../ports/test-instance-repository.js";
import { TestInstanceSettingsStore } from "../ports/test-instance-settings-store.js";
import { runAdbInstall } from "./adb-install.js";
import { keepOutputs } from "./build-outputs.js";
import { InstanceFiles } from "./instance-files.js";
import { TestBuildRetention } from "./test-build-retention.js";
import { OfficePort } from "./test-instance-limits.js";
import { RunningTestInstances } from "./running-test-instances.js";

/** A Hosted, Build to install or Install on a device test target, as a page lists it to launch. */
export interface LaunchableTarget {
  readonly key: string;
  readonly name: string;
  readonly kind: TestInstanceKind;
  /** A Hosted or Build to install target's entry point; undefined for Install on a device. */
  readonly entryPoint: TargetEntryPoint | undefined;
  /** An Install on a device target's settings, with its device's name now; undefined otherwise. */
  readonly installs: LaunchableInstall | undefined;
}

/**
 * What an Install on a device target installs, on what: names as the Project has them now, each
 * undefined when it is gone.
 */
export interface LaunchableInstall extends ListedInstall {
  readonly device:
    | {
        readonly projectDeviceId: string;
        readonly name: string;
        readonly kind: TestInstanceDeviceKind;
      }
    | undefined;
}

/** A test instance with its branch read, as every page shows it. */
export type TestInstanceOnBranch = TestInstance & { readonly branch: string };

/** A test target as the Initiative's page lists it, with its instances on the Initiative. */
export interface InitiativeTarget extends LaunchableTarget {
  /** Newest first. */
  readonly instances: readonly TestInstanceOnBranch[];
}

/** One Project where the Initiative has a branch. */
export interface InitiativeTestProject {
  readonly projectId: string;
  readonly runEnvironmentOn: boolean;
  /** The branch's tip as the Project's repository has it, unfetched; undefined with none. */
  readonly branchCommit: string | undefined;
  readonly targets: readonly InitiativeTarget[];
}

/** One branch of a Project with the instances launched on it. */
export interface ProjectTestBranch {
  readonly name: string;
  /** The branch's tip as the Project's repository has it, unfetched; undefined with none. */
  readonly branchCommit: string | undefined;
  /** Newest first. */
  readonly instances: readonly TestInstanceOnBranch[];
}

/** A Project's test instances, as its page shows them. */
export interface ProjectTestInstances {
  readonly runEnvironmentOn: boolean;
  readonly targets: readonly LaunchableTarget[];
  /** Each branch with instances, the one launched on last first. */
  readonly branches: readonly ProjectTestBranch[];
  /** The Initiatives its instances are linked to, by id, with their names. */
  readonly initiatives: readonly { readonly id: string; readonly name: string }[];
}

/** What launching on an Initiative names: the Project and its test target. */
export interface Launch {
  readonly projectId: string;
  readonly targetKey: string;
  /** The tab relaying an Install on a device target's device over USB (spec §2.13). */
  readonly relayTab?: string | undefined;
}

/** What every launch comes to: the target, the branch and the Initiative it is linked to. */
interface LaunchRequest {
  readonly projectId: string;
  readonly branch: string;
  readonly targetKey: string;
  readonly initiativeId: string | undefined;
  /** The Action whose run launches it; undefined for a launch by hand. */
  readonly runAs?: TestInstanceRunAs | undefined;
  /** The tab relaying an Install on a device target's device over USB. */
  readonly relayTab?: string | undefined;
}

/** The instance's log from an offset, and its state, so a reader stops once it has ended. */
export interface InstanceLog {
  readonly text: string;
  readonly nextOffset: number;
  readonly state: TestInstanceState;
}

/** What The Office holds in memory for an instance from its launch until it ends. */
interface Held {
  /** Ends a launch still Building, or an install still Installing: its stop. */
  readonly building: AbortController;
  /** Its target's Secret variables, hidden in every line of its log. */
  readonly mask: InstanceMask;
  idleStop?: Wait;
  /** How it was stopped, once it was. */
  stoppedBy?: StopReason;
  /** An Install on a device instance's: the tab relaying its device over USB. */
  readonly relayTab?: string | undefined;
  /** An Install on a device instance's hold of its device while it has one. */
  holdId?: string;
  /** Ends its install step early: the Install time ran out, or its hold ended. */
  installing?: AbortController;
  /** Why its install step was ended early: the Install time ran out, or its hold ended. */
  installEnd?: "timeout" | "hold-ended";
}

/**
 * Test instances (spec §2.12): launching a Hosted test target on a branch of a Project, linked to an
 * Initiative or not, in its own checkout and compose project, its Proxy port and the Test instances at once limit, its log, and
 * its stop by the user, by Idle time, as its Initiative ends and in the sweep as The Office starts;
 * and building a Build to install one, in the run environment or on the workstation, its output
 * files kept in `<office-data>/test-builds/<id>/`. Run environments are reached only through
 * `HostedServices`, which takes no run environment slot.
 */
@Injectable()
export class TestInstances implements OnModuleInit {
  private readonly logger = new Logger(TestInstances.name);
  private readonly held = new Map<string, Held>();
  /** The check of the limit and the ports with the insert, one launch at a time. */
  private launching: Promise<unknown> = Promise.resolve();
  /** The work going on in the background, which a test waits for. */
  private readonly background = new Set<Promise<void>>();

  constructor(
    private readonly repository: TestInstanceRepository,
    private readonly settings: TestInstanceSettingsStore,
    private readonly initiatives: Initiatives,
    private readonly targets: ProjectTestTargets,
    private readonly hostedServices: HostedServices,
    private readonly running: RunningTestInstances,
    private readonly files: InstanceFiles,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
    private readonly officePort: OfficePort,
    private readonly retention: TestBuildRetention,
    private readonly devices: InstallDevices,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(InitiativeStateChanged, ({ initiativeId, to }) => {
      if (to !== "done" && to !== "dropped") return;
      // In the background: the bus waits for its handlers, and the state change for nothing.
      this.inBackground(
        `The test instances of the Initiative ${initiativeId} were not stopped.`,
        () => this.stopEachOf(initiativeId, { kind: "initiative-ended", state: to }),
      );
    });
    this.events.subscribe(ProjectFeaturesChanged, ({ projectId, features }) => {
      if (features["test-targets"]) return;
      this.inBackground(`The test instances of the Project ${projectId} were not stopped.`, () =>
        this.stopEachOfProject(projectId, BY_TEST_TARGETS_OFF),
      );
    });
    // A hold ended by something else than its own letting go (the Run environment turned Off,
    // Connected devices switched off) ends the install step, which fails the instance.
    this.devices.onHoldEnded((instanceId, holdId) => {
      const held = this.held.get(instanceId);
      if (held?.holdId !== holdId || held.installing === undefined) return;
      held.installEnd ??= "hold-ended";
      held.installing.abort();
    });
  }

  /**
   * A group per Project where the Initiative has a branch, each with its Hosted, Build to install
   * and Install on a device test targets; none for a Project with Test targets switched off.
   */
  async listFor(initiativeId: string): Promise<InitiativeTestProject[]> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) throw TestInstanceNotFound.initiative(initiativeId);
    const instances = await this.onBranches(await this.repository.listOf(initiativeId));
    return Promise.all(
      initiative.branches.map(async ({ projectId, branch }) => {
        const [targets, runEnvironmentOn, branchCommit] = await Promise.all([
          this.launchableTargetsOf(projectId),
          this.targets.runEnvironmentOn(projectId),
          this.targets.branchCommitOf(projectId, branch),
        ]);
        return {
          projectId,
          runEnvironmentOn,
          branchCommit,
          targets: targets.map((target) => ({
            ...target,
            instances: instances.filter(
              (instance) => instance.projectId === projectId && instance.targetKey === target.key,
            ),
          })),
        };
      }),
    );
  }

  /** Every active instance, then those Built or Failed since `since`, newest first. */
  async activity(since: Date): Promise<readonly TestInstance[]> {
    return [...(await this.repository.active()), ...(await this.repository.endedSince(since))];
  }

  /**
   * The Project's launchable test targets and every instance launched on it,
   * linked to an Initiative or not, by branch; no targets while it has Test targets switched off.
   */
  async listForProject(projectId: string): Promise<ProjectTestInstances> {
    const [targets, runEnvironmentOn, rows] = await Promise.all([
      this.launchableTargetsOf(projectId),
      this.targets.runEnvironmentOn(projectId),
      this.repository.listOfProject(projectId),
    ]);
    const instances = await this.onBranches(rows);
    const names = [...new Set(instances.map(({ branch }) => branch))];
    const branches = await Promise.all(
      names.map(async (name) => ({
        name,
        branchCommit: await this.targets.branchCommitOf(projectId, name),
        instances: instances.filter(({ branch }) => branch === name),
      })),
    );
    const linked = [...new Set(instances.flatMap(({ initiativeId }) => initiativeId ?? []))];
    const initiatives = await Promise.all(linked.map((id) => this.initiatives.find(id)));
    return {
      runEnvironmentOn,
      targets,
      branches,
      initiatives: initiatives.flatMap((initiative) =>
        initiative === undefined ? [] : [{ id: initiative.id, name: initiative.name }],
      ),
    };
  }

  async read(id: string): Promise<TestInstanceOnBranch> {
    const instance = await this.repository.find(id);
    if (!instance) throw TestInstanceNotFound.instance(id);
    return this.onBranch(instance);
  }

  /**
   * Launches the target on the Initiative's branch in the Project, linked to the Initiative:
   * refused unless the Initiative is active with a branch there, then as `launch` refuses.
   */
  async launchOnInitiative(
    initiativeId: string,
    { projectId, targetKey, relayTab }: Launch,
    by: LaunchedBy,
  ): Promise<TestInstanceOnBranch> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) throw TestInstanceNotFound.initiative(initiativeId);
    if (initiative.state !== "active") throw new TestInstanceRefused([INITIATIVE_NOT_ACTIVE]);
    const onProject = initiative.branches.find((each) => each.projectId === projectId);
    if (!onProject) throw new TestInstanceRefused([noInitiativeBranch(projectId)]);
    return this.launch(
      { projectId, branch: onProject.branch, targetKey, initiativeId, relayTab },
      by,
    );
  }

  /**
   * Launches the target on any branch of the Project, from its page: linked to the active
   * Initiative whose branch it is, if any, else to none. A branch neither the repository nor its
   * remote has fails the launch as its checkout's fetch does, naming the branch. `runAs` names the
   * Action whose run launches it, kept and shown "Run as <Action>" (spec §2.15, "Action run"); the
   * launch is otherwise the same, refused by the same rules. `relayTab` is the tab relaying an
   * Install on a device target's device over USB.
   */
  async launchOnBranch(
    projectId: string,
    branch: string,
    targetKey: string,
    by: LaunchedBy,
    runAs?: TestInstanceRunAs,
    relayTab?: string,
  ): Promise<TestInstanceOnBranch> {
    const initiative = await this.initiatives.activeInitiativeOnBranch(projectId, branch);
    return this.launch(
      { projectId, branch, targetKey, initiativeId: initiative?.id, runAs, relayTab },
      by,
    );
  }

  /**
   * Every launch: refused, with every reason, unless the target is Hosted or Build to install
   * with its Secret variables typed and the limit has room; a Hosted one also needs the Project's
   * Run environment On and a free Proxy port. Answers the instance Building at once; the checkout
   * and the start or the build go on in the background, ending Running, Built or Failed.
   */
  private async launch(launch: LaunchRequest, by: LaunchedBy): Promise<TestInstanceOnBranch> {
    const target = await this.targets.launchOf(launch.projectId, launch.targetKey);
    if (target.kind === "install-on-a-device") return this.launchInstall(launch, target, by);
    const hosted = target.kind === "hosted" && target.containerPort !== undefined;
    if (!hosted && target.kind !== "build-to-install") {
      throw new TestInstanceRefused([notLaunchable(target.name)]);
    }
    const problems = [
      ...(!hosted || target.runEnvironmentOn ? [] : [RUN_ENVIRONMENT_OFF]),
      ...(target.secretsWithoutValue.length === 0
        ? []
        : [secretsWithoutValue(target.secretsWithoutValue)]),
    ];
    if (problems.length > 0) throw new TestInstanceRefused(problems);

    const { instance, idleMinutes } = await this.oneAtATime(async () => {
      const { settings, active } = await this.withinTheLimit();
      const given = {
        id: randomUUID(),
        initiativeId: launch.initiativeId,
        projectId: launch.projectId,
        branch: launch.branch,
        targetKey: target.key,
        targetName: target.name,
        launchedBy: by,
        at: this.schedule.now(),
        runAs: launch.runAs,
      };
      const made = hosted
        ? launchedInstance({ ...given, kind: "hosted", port: this.proxyPortFor(settings, active) })
        : launchedInstance({ ...given, kind: "build-to-install" });
      await this.repository.add(made);
      return { instance: made, idleMinutes: settings.idleMinutes };
    });
    const held: Held = { building: new AbortController(), mask: target.mask };
    this.held.set(instance.id, held);
    await this.events.publish(
      new TestInstanceLaunched(
        instance.id,
        instance.projectId,
        instance.initiativeId,
        instance.port,
      ),
    );
    this.inBackground(`The Test instance ${instance.id} didn't launch.`, () =>
      hosted
        ? this.startHosted(instance, launch.branch, target, held, idleMinutes)
        : this.runBuild(instance, launch.branch, target, held),
    );
    return { ...instance, branch: launch.branch };
  }

  /**
   * Stops a Building, Installing or Running instance: Stopped, or Failed for a Build to install or
   * Install on a device one, saying how it stopped; its port freed, its containers, volumes and
   * checkout removed, the reason last in its log; an Install on a device one stops the build it
   * launched with it and lets go of its device. One that has ended already stays as it is.
   */
  async stop(id: string, reason: StopReason = BY_USER): Promise<TestInstanceOnBranch> {
    const instance = await this.read(id);
    if (!isActive(instance)) return instance;
    const held = this.held.get(id);
    if (held) held.stoppedBy ??= reason;
    held?.building.abort();
    const words = stopWords(reason);
    const change = await this.repository.update(id, (kept) =>
      stopped(kept, reason, this.schedule.now()),
    );
    if (!change?.event) return this.read(id);
    await this.files.note(id, words, held?.mask);
    await this.ended(change.instance, change.event);
    await this.stopItsBuild(change.instance, reason);
    return { ...change.instance, branch: instance.branch };
  }

  /**
   * The path of one of a Built instance's files, by its name as listed on the instance; refused
   * as not found for any other name, an instance not Built or one whose files were removed, so no
   * unlisted name is ever joined into a path.
   */
  async builtFile(id: string, name: string): Promise<string> {
    const instance = await this.read(id);
    if (!hasFile(instance, name)) throw TestInstanceNotFound.file(id);
    return join(this.files.buildFilesOf(id), name);
  }

  /** The instance's masked log from byte `from` on. */
  async readLog(id: string, from: number): Promise<InstanceLog> {
    const instance = await this.read(id);
    const { text, nextOffset } = await this.files.read(id, from);
    return { text, nextOffset, state: instance.state };
  }

  /**
   * As The Office starts (from office.ts, never a module's start): every instance left Running
   * ends Stopped and every one left Building or Installing Failed, saying The Office restarted;
   * then the runtime's Hosted instances, install environments and the checkouts left are removed.
   * Logs stay.
   */
  async sweep(): Promise<void> {
    const at = this.schedule.now();
    for (const instance of await this.repository.active()) {
      const words = restartWordsOf(instance.state);
      const change = await this.repository.update(instance.id, (kept) =>
        words === undefined ? stopped(kept, BY_RESTART, at) : failed(kept, words, at),
      );
      if (!change?.event) continue;
      await this.files.note(instance.id, words ?? stopWords(BY_RESTART));
      await this.events.publish(change.event);
    }
    await this.hostedServices.sweep();
    for (const checkout of await this.files.leftCheckouts()) {
      await this.targets.removeCheckout(checkout);
    }
  }

  /**
   * An Install on a device launch: refused, with every reason, unless the Project's Run environment
   * is On and its Build to install target there with its Secret variables typed; then while its
   * device isn't free, naming the holder, and while the limit has no room. Answers the instance
   * Building at once; its checkout, its build or the reuse of one, and the install go on in the
   * background.
   */
  private async launchInstall(
    launch: LaunchRequest,
    target: InstallLaunch,
    by: LaunchedBy,
  ): Promise<TestInstanceOnBranch> {
    const { build } = target;
    const problems = [
      ...(target.runEnvironmentOn ? [] : [RUN_ENVIRONMENT_OFF_FOR_INSTALL]),
      ...(build === undefined ? [buildTargetGone(target.buildTargetKey)] : []),
      ...(build === undefined || build.secretsWithoutValue.length === 0
        ? []
        : [secretsWithoutValue(build.secretsWithoutValue)]),
    ];
    if (build === undefined || problems.length > 0) throw new TestInstanceRefused(problems);
    const device = await this.devices.checkFree(launch.projectId, target.projectDeviceId);

    const instance = await this.oneAtATime(async () => {
      await this.withinTheLimit();
      const made = launchedInstance({
        id: randomUUID(),
        initiativeId: launch.initiativeId,
        projectId: launch.projectId,
        branch: launch.branch,
        targetKey: target.key,
        targetName: target.name,
        launchedBy: by,
        at: this.schedule.now(),
        runAs: launch.runAs,
        kind: "install-on-a-device",
        device: { projectDeviceId: device.id, name: device.name, kind: device.kind },
      });
      await this.repository.add(made);
      return made;
    });
    const held: Held = {
      building: new AbortController(),
      mask: target.mask,
      relayTab: launch.relayTab,
    };
    this.held.set(instance.id, held);
    await this.events.publish(
      new TestInstanceLaunched(instance.id, instance.projectId, instance.initiativeId, undefined),
    );
    this.inBackground(`The Test instance ${instance.id} didn't install.`, () =>
      this.install(instance, launch.branch, build, held),
    );
    return { ...instance, branch: launch.branch };
  }

  /** Waits for the launches and stops going on in the background, for a test. */
  async settled(): Promise<void> {
    while (this.background.size > 0) await Promise.all(this.background);
  }

  /**
   * The settings and every active instance, refused, naming those that count, when Test instances
   * at once has no room; run inside `oneAtATime` with the insert.
   */
  private async withinTheLimit(): Promise<{
    readonly settings: Awaited<ReturnType<TestInstanceSettingsStore["read"]>>;
    readonly active: readonly TestInstance[];
  }> {
    const settings = await this.settings.read();
    const active = await this.repository.active();
    const counted = countedTowardTheLimit(active);
    const over = overTheLimit(await this.namesOf(counted), settings.testInstancesAtOnce);
    if (over !== undefined) throw new TestInstanceRefused([over]);
    return { settings, active };
  }

  /** The lowest free Proxy port; never The Office's own, should OFFICE_PORT fall inside the range. */
  private proxyPortFor(
    settings: Awaited<ReturnType<TestInstanceSettingsStore["read"]>>,
    active: readonly TestInstance[],
  ): number {
    const held = new Set([
      this.officePort.port,
      ...active.flatMap(({ port }) => (port === undefined ? [] : [port])),
    ]);
    const port = freeProxyPort(settings, held);
    if (port === undefined) throw new TestInstanceRefused([everyPortInUse(settings)]);
    return port;
  }

  /**
   * The checkout of the branch's tip, its commit recorded, and the entry point checked at it;
   * answers false when the instance was stopped meanwhile, the checkout removed again.
   */
  private async checkedOut(
    instance: TestInstance,
    branch: string,
    target: TargetLaunch | undefined,
    held: Held,
  ): Promise<boolean> {
    const { id, projectId } = instance;
    const checkout = this.files.checkoutOf(id);
    await this.files.note(id, `Fetching ${branch}.`, held.mask);
    const { commit } = await this.targets.checkOut(projectId, branch, checkout);
    if (held.building.signal.aborted) {
      await this.targets.removeCheckout(checkout);
      return false;
    }
    await this.files.note(id, `Checked out ${branch} at ${commit}.`, held.mask);
    const recorded = await this.repository.update(id, (kept) => withCommit(kept, commit));
    if (recorded) {
      await this.events.publish(
        new TestInstanceCommitRecorded(id, projectId, instance.initiativeId, commit),
      );
    }
    // Install on a device runs no entry point of its own: its build's is checked at its launch.
    if (target === undefined) return true;
    const problems = await this.targets.entryPointProblemsAt(projectId, commit, target.key);
    if (problems.length > 0) throw new TestInstanceRefused(problems);
    return true;
  }

  /** The checkout, the entry point's check and the start, ending Running or Failed. */
  private async startHosted(
    instance: TestInstance,
    branch: string,
    target: TargetLaunch,
    held: Held,
    idleMinutes: number,
  ): Promise<void> {
    const { id, projectId } = instance;
    const signal = held.building.signal;
    const checkout = this.files.checkoutOf(id);
    try {
      refuseMissingCommands(target);
      if (!(await this.checkedOut(instance, branch, target, held))) return;
      const install = await this.targets.installSettingsOf(projectId);
      const { hostPort } = await this.hostedServices.start(
        {
          instanceId: id,
          projectId,
          checkout,
          entryPoint: target.entryPoint,
          containerPort: target.containerPort ?? 0,
          variables: target.variables.map(({ name, value }) => ({ name, value })),
          // The adapter fills contracts' DEFAULT_PORT_VARIABLE in for a Hosted target already.
          portVariable: target.portVariable ?? "PORT",
          commandsBefore: commandsBeforeOf(target),
          memoryMegabytes: target.memoryMegabytes,
          installCommand: install.installCommand,
          installInputs: install.installInputs,
          installVariables: install.installVariables,
          logFile: this.files.logOf(id),
          mask: held.mask,
          signal,
        },
        (reason) =>
          this.inBackground(`The Test instance ${id} that ended wasn't marked Failed.`, () =>
            this.fail(id, reason),
          ),
      );
      const change = await this.repository.update(id, (kept) =>
        startedRunning(kept, this.schedule.now()),
      );
      if (!change?.event) {
        // Stopped or Failed while it started: what it started goes.
        await this.hostedServices.stop(id);
        return;
      }
      this.running.add({
        id,
        port: instance.port ?? 0,
        hostPort,
        appPort: target.containerPort ?? 0,
      });
      this.armIdleStop(id, held, idleMinutes);
      await this.events.publish(change.event);
    } catch (error) {
      if (signal.aborted) return;
      await this.fail(id, reasonOf(error));
    }
  }

  /**
   * The checkout, the entry point's check and the build, then its output files kept: Built, or
   * Failed with why. A build stopped meanwhile leaves the row as the stop wrote it.
   */
  private async runBuild(
    instance: TestInstance,
    branch: string,
    target: TargetLaunch,
    held: Held,
  ): Promise<void> {
    const { id } = instance;
    const signal = held.building.signal;
    const checkout = this.files.checkoutOf(id);
    try {
      refuseMissingCommands(target);
      if (!(await this.checkedOut(instance, branch, target, held))) return;
      const end = await this.buildIn(instance, target, held);
      if (signal.aborted) {
        await this.targets.removeCheckout(checkout);
        return;
      }
      const failure = buildFailureOf(end);
      if (failure !== undefined) {
        await this.fail(id, failure);
        return;
      }
      const kept = await keepOutputs(checkout, target.outputPatterns, this.files.buildFilesOf(id));
      if ("problem" in kept) {
        await this.fail(id, kept.problem);
        return;
      }
      const change = await this.repository.update(id, (row) =>
        built(row, kept.files, this.schedule.now()),
      );
      if (!change?.event) {
        // Stopped while its files were copied: they go with it.
        await this.files.removeBuildFiles(id);
        return;
      }
      await this.files.note(
        id,
        `Built: ${kept.files.map(({ name }) => name).join(", ")}.`,
        held.mask,
      );
      await this.ended(change.instance, change.event);
      await this.retention.keepNewest(instance);
    } catch (error) {
      if (signal.aborted) {
        await this.files.removeBuildFiles(id);
        return;
      }
      await this.fail(id, reasonOf(error));
    }
  }

  /**
   * An Install on a device instance in the background: its checkout, then the build target's newest
   * Built files on the branch when they are of its commit and still kept, else a build of its own;
   * then the install. Failed with why, unless it was stopped meanwhile.
   */
  private async install(
    instance: TestInstance,
    branch: string,
    build: TargetLaunch,
    held: Held,
  ): Promise<void> {
    const signal = held.building.signal;
    try {
      if (!(await this.checkedOut(instance, branch, undefined, held))) return;
      const buildId =
        (await this.reusedBuild(instance, branch, build, held)) ??
        (await this.buildFor(instance, branch, build, held));
      if (buildId === undefined) return;
      await this.installFrom(instance, buildId, held);
    } catch (error) {
      if (signal.aborted) return;
      await this.fail(instance.id, reasonOf(error));
    }
  }

  /**
   * The build target's newest Built instance on the branch, when it ran the commit this instance
   * checked out and its files are still kept (spec §2.12, "Reusing Built files"); its id, said in
   * the log, or undefined.
   */
  private async reusedBuild(
    instance: TestInstance,
    branch: string,
    build: TargetLaunch,
    held: Held,
  ): Promise<string | undefined> {
    const [checkedOut, newest] = await Promise.all([
      this.repository.find(instance.id),
      this.repository.newestBuilt(instance.projectId, build.key, branch),
    ]);
    const commit = checkedOut?.commit;
    if (
      newest === undefined ||
      commit === undefined ||
      newest.commit !== commit ||
      newest.filesRemovedAt !== undefined
    ) {
      return undefined;
    }
    await this.files.note(
      instance.id,
      reusingWords({
        id: newest.id,
        commit: newest.commit,
        builtAt: newest.endedAt ?? newest.launchedAt,
      }),
      held.mask,
    );
    return newest.id;
  }

  /**
   * Launches a Build to install instance of the build target on the same branch for the install,
   * made, linked and kept as any other, "Built for" the install's target, and waits for it while
   * the install is Building (spec §2.12, "Its build"). The two count as one toward the limit, so
   * the build is linked to the install before anyone counts it. Answers the build's id once Built;
   * undefined once the install was stopped, or failed with the build's reason.
   */
  private async buildFor(
    install: TestInstance,
    branch: string,
    build: TargetLaunch,
    held: Held,
  ): Promise<string | undefined> {
    const made = await this.oneAtATime(async () => {
      const buildInstance = launchedInstance({
        id: randomUUID(),
        initiativeId: install.initiativeId,
        projectId: install.projectId,
        branch,
        targetKey: build.key,
        targetName: build.name,
        launchedBy: install.launchedBy,
        at: this.schedule.now(),
        kind: "build-to-install",
        builtFor: { targetKey: install.targetKey, targetName: install.targetName },
      });
      const linked = await this.repository.update(install.id, (kept) =>
        withBuild(kept, buildInstance.id),
      );
      // Stopped meanwhile: no build.
      if (!linked) return undefined;
      await this.repository.add(buildInstance);
      return buildInstance;
    });
    if (made === undefined) return undefined;
    const buildHeld: Held = { building: new AbortController(), mask: build.mask };
    this.held.set(made.id, buildHeld);
    await this.events.publish(
      new TestInstanceLaunched(made.id, made.projectId, made.initiativeId, undefined),
    );
    await this.files.note(install.id, buildingWords(made.id, build.name), held.mask);
    if (held.building.signal.aborted) {
      // Stopped as its build was made, before the stop could see it: the build stops too.
      await this.stop(made.id, held.stoppedBy ?? BY_USER);
      return undefined;
    }
    await this.runBuild(made, branch, build, buildHeld);
    if (held.building.signal.aborted) return undefined;
    const ended = await this.repository.find(made.id);
    if (ended?.state === "built") return made.id;
    await this.fail(install.id, buildFailed(ended?.failedReason));
    return undefined;
  }

  /**
   * Installing the build's files on the device (spec §2.12, "Installing"), the Install time counted
   * from here: only its `.apk` files, its own environment from its checkout's definition with the
   * files mounted, the device held there, then adb. Installed on adb's `Success`, else Failed with
   * why; the device let go of, then the environment removed, however it ends.
   */
  private async installFrom(instance: TestInstance, buildId: string, held: Held): Promise<void> {
    const { id, projectId, device } = instance;
    const build = await this.repository.find(buildId);
    const moved = await this.repository.update(id, (kept) => startedInstalling(kept, buildId));
    if (!moved?.event || device === undefined) return;
    await this.events.publish(moved.event);

    const installing = new AbortController();
    held.installing = installing;
    const timeout = this.schedule.once(
      `test-instance-install-${id}`,
      new Date(this.schedule.now().getTime() + INSTALL_TIMEOUT_MS),
      () => {
        held.installEnd ??= "timeout";
        installing.abort();
        return Promise.resolve();
      },
    );
    const signal = AbortSignal.any([held.building.signal, installing.signal]);
    let environment: TestInstallEnvironment | undefined;
    let failure: string | undefined;
    try {
      const { apks, others } = apksOf(build?.files.map(({ name }) => name) ?? []);
      if (apks.length === 0) throw new TestInstanceRefused([NO_APK]);
      if (others.length > 0) await this.files.note(id, ignoredWords(others), held.mask);
      // A device taken while the build ran fails it here, before its environment starts.
      await this.devices.checkFree(projectId, device.projectDeviceId);
      const install = await this.targets.installSettingsOf(projectId);
      const started = await this.hostedServices.install({
        instanceId: id,
        projectId,
        checkout: this.files.checkoutOf(id),
        buildFiles: this.files.buildFilesOf(buildId),
        installCommand: install.installCommand,
        installInputs: install.installInputs,
        installVariables: install.installVariables,
        logFile: this.files.logOf(id),
        mask: held.mask,
        signal,
      });
      environment = started;
      const hold = await this.devices.hold({
        projectId,
        projectDeviceId: device.projectDeviceId,
        instanceId: id,
        holderName: holderNameOf(await this.nameOf(instance)),
        startedBy: instance.launchedBy.user,
        environment: {
          label: `the Test instance ${id}`,
          checksUser: started.checksUser,
          attach: (attachment) => started.attach(attachment),
        },
        relayTab: held.relayTab,
        signal,
      });
      if (hold.holdId !== undefined) held.holdId = hold.holdId;
      if (!hold.held) throw new TestInstanceRefused([hold.problem]);
      await this.files.note(id, `Installing ${apks.join(", ")} on ${device.name}.`, held.mask);
      const end = await runAdbInstall(
        started,
        adbInstallArguments(hold.serial, started.filesMount, apks),
        this.files.logOf(id),
        held.mask,
        signal,
      );
      failure = installFailureOf(end, device.name);
    } catch (error) {
      failure = reasonOf(error);
    } finally {
      timeout.cancel();
      held.installing = undefined;
    }
    await this.letGoOf(id, held);
    await environment?.remove();
    // Stopped: the stop wrote how it ended.
    if (held.building.signal.aborted) return;
    if (installing.signal.aborted) {
      failure = held.installEnd === "timeout" ? INSTALL_RAN_OUT : deviceLetGo(device.name);
    }
    if (failure !== undefined) {
      await this.fail(id, failure);
      return;
    }
    const change = await this.repository.update(id, (kept) => installed(kept, this.schedule.now()));
    if (!change?.event) return;
    await this.files.note(id, `Installed on ${device.name}.`, held.mask);
    await this.ended(change.instance, change.event);
  }

  /** Lets go of an install's device, once; its own Disconnected then fails nothing. */
  private async letGoOf(id: string, held: Held): Promise<void> {
    const { holdId } = held;
    if (holdId === undefined) return;
    held.holdId = undefined;
    await this.devices.letGo(holdId).catch((error: unknown) => {
      this.logger.warn(`The device of the Test instance ${id} wasn't let go of.`, error);
    });
  }

  /** An Install on a device instance stopped while its build runs: the build stops with it. */
  private async stopItsBuild(instance: TestInstance, reason: StopReason): Promise<void> {
    if (instance.kind !== "install-on-a-device" || instance.buildInstanceId === undefined) return;
    const build = await this.repository.find(instance.buildInstanceId);
    if (build !== undefined && isActive(build)) await this.stop(build.id, reason);
  }

  /**
   * Runs the build: in the Project's run environment when it is On, through `HostedServices`,
   * otherwise on the workstation the way checks run there; only the target's own variables.
   */
  private async buildIn(
    instance: TestInstance,
    target: TargetLaunch,
    held: Held,
  ): Promise<BuildEnd> {
    const { id, projectId } = instance;
    const { entryPoint } = target;
    if (entryPoint.kind === "devcontainer-service") {
      throw new TestInstanceRefused([DEVCONTAINER_SERVICE_BUILDS_NOTHING]);
    }
    const checkout = this.files.checkoutOf(id);
    const logFile = this.files.logOf(id);
    const signal = held.building.signal;
    if (target.runEnvironmentOn) {
      const install = await this.targets.installSettingsOf(projectId);
      return this.hostedServices.build({
        instanceId: id,
        projectId,
        checkout,
        entryPoint,
        variables: target.variables.map(({ name, value }) => ({ name, value })),
        commandsBefore: commandsBeforeOf(target),
        memoryMegabytes: target.memoryMegabytes,
        installCommand: install.installCommand,
        installInputs: install.installInputs,
        installVariables: install.installVariables,
        logFile,
        mask: held.mask,
        signal,
        timeoutMs: BUILD_TIMEOUT_MS,
      });
    }
    const command = workstationBuildCommandOf(entryPoint);
    if ("problem" in command) throw new TestInstanceRefused([command.problem]);
    // The commands before the entry point and the entry point share the build's time.
    const deadline = Date.now() + BUILD_TIMEOUT_MS;
    const variables = [...target.variables, TEST_INSTANCE_MARK];
    for (const { name, commandLine } of target.commandsBefore) {
      await this.files.note(id, `Running the Project's command ${name}.`, held.mask);
      const end = await this.targets.runBuild({
        checkout,
        folder: ".",
        commandLine,
        variables,
        logFile,
        timeoutMs: remainingOf(deadline),
        signal,
      });
      if (end.endedBy === "timeout" || end.endedBy === "stop") return end;
      const failure = commandBeforeFailureOf(name, end);
      if (failure !== undefined) throw new TestInstanceRefused([failure]);
    }
    await this.files.note(
      id,
      `Running ${command.commandLine} in ${command.folder} on the workstation.`,
      held.mask,
    );
    return this.targets.runBuild({
      checkout,
      folder: command.folder,
      commandLine: command.commandLine,
      variables,
      logFile,
      timeoutMs: remainingOf(deadline),
      signal,
    });
  }

  /** Building, Installing or Running → Failed, saying why in its log too, and what it holds removed. */
  private async fail(id: string, reason: string): Promise<void> {
    const change = await this.repository.update(id, (kept) =>
      failed(kept, reason, this.schedule.now()),
    );
    if (!change?.event) return;
    await this.files.note(id, `Failed: ${reason}`, this.held.get(id)?.mask);
    await this.ended(change.instance, change.event);
  }

  /** It ended: told, then its containers, volumes and checkout removed. */
  private async ended(instance: TestInstance, event: TestInstanceStateChanged): Promise<void> {
    const held = this.held.get(instance.id);
    held?.idleStop?.cancel();
    this.held.delete(instance.id);
    this.running.remove(instance.id);
    await this.events.publish(event);
    // An install lets go of its device before its environment goes.
    if (held?.holdId !== undefined) await this.letGoOf(instance.id, held);
    // A build's compose project goes as its build ends, which a stop's abort ends.
    if (instance.kind !== "build-to-install") {
      await this.hostedServices.stop(instance.id).catch((error: unknown) => {
        this.logger.warn(`The Test instance ${instance.id} wasn't removed.`, error);
      });
    }
    await this.targets.removeCheckout(this.files.checkoutOf(instance.id));
  }

  /**
   * Stops the instance once it has gone the Idle time with no request; a request meanwhile moves
   * the stop on when it is due, so activity costs no timer.
   */
  private armIdleStop(id: string, held: Held, minutes: number): void {
    const idleMs = minutes * 60_000;
    const arm = (at: number): void => {
      held.idleStop = this.schedule.once(`test-instance-idle-${id}`, new Date(at), async () => {
        const last = this.running.lastActivityOf(id);
        if (last === undefined) return;
        if (last + idleMs > this.schedule.now().getTime()) {
          arm(last + idleMs);
          return;
        }
        await this.stop(id, { kind: "idle", minutes });
      });
    };
    arm(this.schedule.now().getTime() + idleMs);
  }

  private async stopEachOf(initiativeId: string, reason: StopReason): Promise<void> {
    for (const instance of await this.repository.listOf(initiativeId)) {
      if (isActive(instance)) await this.stop(instance.id, reason);
    }
  }

  /** Every Building or Running instance of the Project, linked to an Initiative or not. */
  private async stopEachOfProject(projectId: string, reason: StopReason): Promise<void> {
    for (const instance of await this.repository.active()) {
      if (instance.projectId === projectId) await this.stop(instance.id, reason);
    }
  }

  /**
   * The Project's Hosted, Build to install and Install on a device targets, the last with their
   * device's name now; none while Test targets are off.
   */
  private async launchableTargetsOf(projectId: string): Promise<LaunchableTarget[]> {
    const [on, targets] = await Promise.all([
      this.targets.testTargetsOn(projectId),
      this.targets.targetsOf(projectId),
    ]);
    if (!on) return [];
    const devices = targets.some(({ installs }) => installs !== undefined)
      ? await this.devices.devicesOf(projectId)
      : [];
    return targets.flatMap(({ key, name, kind, entryPoint, installs }): LaunchableTarget[] => {
      if (kind === "install-on-a-device" && installs !== undefined) {
        const device = devices.find(({ id }) => id === installs.projectDeviceId);
        return [
          {
            key,
            name,
            kind,
            entryPoint: undefined,
            installs: {
              ...installs,
              device: device && {
                projectDeviceId: device.id,
                name: device.name,
                kind: device.kind,
              },
            },
          },
        ];
      }
      return (kind === "hosted" || kind === "build-to-install") && entryPoint !== undefined
        ? [{ key, name, kind, entryPoint, installs: undefined }]
        : [];
    });
  }

  /**
   * Each instance as the limit's refusal names it: by its target's name and its Initiative's, or
   * its branch's when it is linked to none.
   */
  private namesOf(active: readonly TestInstance[]): Promise<ActiveInstanceName[]> {
    return Promise.all(active.map((instance) => this.nameOf(instance)));
  }

  private async nameOf(instance: TestInstance): Promise<ActiveInstanceName> {
    const { targetName, initiativeId } = instance;
    if (initiativeId === undefined) {
      return { targetName, branch: (await this.onBranch(instance)).branch };
    }
    const initiative = await this.initiatives.find(initiativeId);
    return { targetName, initiativeName: initiative?.name ?? "an Initiative" };
  }

  /**
   * The instance with its branch: as recorded, or, on a row from before branches were recorded,
   * its Initiative's in its Project. The one place that reading happens.
   */
  private async onBranch(instance: TestInstance): Promise<TestInstanceOnBranch> {
    if (instance.branch !== undefined) return { ...instance, branch: instance.branch };
    const initiative =
      instance.initiativeId === undefined
        ? undefined
        : await this.initiatives.find(instance.initiativeId);
    const branch = initiative?.branches.find(({ projectId }) => projectId === instance.projectId);
    return { ...instance, branch: branch?.branch ?? "" };
  }

  private onBranches(instances: readonly TestInstance[]): Promise<TestInstanceOnBranch[]> {
    return Promise.all(instances.map((instance) => this.onBranch(instance)));
  }

  private oneAtATime<Result>(step: () => Promise<Result>): Promise<Result> {
    const next = this.launching.then(step, step);
    this.launching = next.catch(() => undefined);
    return next;
  }

  private inBackground(failure: string, work: () => Promise<void>): void {
    const running = work()
      .catch((error: unknown) => {
        this.logger.error(failure, error);
      })
      .finally(() => this.background.delete(running));
    this.background.add(running);
  }
}

/** Why an instance left in `state` by a restart failed; undefined for one that only stops. */
function restartWordsOf(state: TestInstanceState): string | undefined {
  switch (state) {
    case "building":
      return RESTARTED_WHILE_BUILDING;
    case "installing":
      return RESTARTED_WHILE_INSTALLING;
    default:
      return undefined;
  }
}

/** A launch whose target runs a command the Project no longer has fails, naming it. */
function refuseMissingCommands(target: TargetLaunch): void {
  if (target.missingCommands.length > 0) {
    throw new TestInstanceRefused([missingCommands(target.missingCommands)]);
  }
}

/** The commands before the entry point as Run environments runs them: a name and a command line. */
function commandsBeforeOf(target: TargetLaunch): { name: string; commandLine: string }[] {
  return target.commandsBefore.map(({ name, commandLine }) => ({ name, commandLine }));
}

/** What is left of a build's time, never below 1 ms. */
function remainingOf(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

/** A start's failure in the user's words. */
function reasonOf(error: unknown): string {
  if (error instanceof TestInstanceRefused || error instanceof RunEnvironmentRefused) {
    return error.reasons.join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}
