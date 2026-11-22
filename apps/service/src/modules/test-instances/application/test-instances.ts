import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { ProjectFeaturesChanged } from "../../projects/index.js";
import { HostedServices, RunEnvironmentRefused } from "../../run-environments/index.js";
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
  RUN_ENVIRONMENT_OFF,
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
  built,
  failed,
  isActive,
  launchedInstance,
  startedRunning,
  stopped,
  withCommit,
  type LaunchedBy,
  type TestInstance,
  type TestInstanceKind,
  type TestInstanceState,
} from "../domain/test-instance.js";
import {
  DEVCONTAINER_SERVICE_BUILDS_NOTHING,
  workstationBuildCommandOf,
  type TargetEntryPoint,
} from "../domain/entry-point.js";
import { Initiatives } from "../ports/initiatives.js";
import {
  ProjectTestTargets,
  type InstanceMask,
  type TargetLaunch,
} from "../ports/project-test-targets.js";
import { TestInstanceRepository } from "../ports/test-instance-repository.js";
import { TestInstanceSettingsStore } from "../ports/test-instance-settings-store.js";
import { keepOutputs } from "./build-outputs.js";
import { InstanceFiles } from "./instance-files.js";
import { TestBuildRetention } from "./test-build-retention.js";
import { OfficePort } from "./test-instance-limits.js";
import { RunningTestInstances } from "./running-test-instances.js";

/** A Hosted or Build to install test target, as a page lists it to launch. */
export interface LaunchableTarget {
  readonly key: string;
  readonly name: string;
  readonly kind: TestInstanceKind;
  readonly entryPoint: TargetEntryPoint;
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
}

/** What every launch comes to: the target, the branch and the Initiative it is linked to. */
interface LaunchRequest {
  readonly projectId: string;
  readonly branch: string;
  readonly targetKey: string;
  readonly initiativeId: string | undefined;
}

/** The instance's log from an offset, and its state, so a reader stops once it has ended. */
export interface InstanceLog {
  readonly text: string;
  readonly nextOffset: number;
  readonly state: TestInstanceState;
}

/** What The Office holds in memory for an instance from its launch until it ends. */
interface Held {
  /** Ends a launch still Building. */
  readonly building: AbortController;
  /** Its target's Secret variables, hidden in every line of its log. */
  readonly mask: InstanceMask;
  idleStop?: Wait;
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
  }

  /**
   * A group per Project where the Initiative has a branch, each with its Hosted and Build to install
   * test targets; none for a Project with Test targets switched off.
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
   * The Project's Hosted and Build to install test targets and every instance launched on it,
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
    { projectId, targetKey }: Launch,
    by: LaunchedBy,
  ): Promise<TestInstanceOnBranch> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) throw TestInstanceNotFound.initiative(initiativeId);
    if (initiative.state !== "active") throw new TestInstanceRefused([INITIATIVE_NOT_ACTIVE]);
    const onProject = initiative.branches.find((each) => each.projectId === projectId);
    if (!onProject) throw new TestInstanceRefused([noInitiativeBranch(projectId)]);
    return this.launch({ projectId, branch: onProject.branch, targetKey, initiativeId }, by);
  }

  /**
   * Launches the target on any branch of the Project, from its page: linked to the active
   * Initiative whose branch it is, if any, else to none. A branch neither the repository nor its
   * remote has fails the launch as its checkout's fetch does, naming the branch.
   */
  async launchOnBranch(
    projectId: string,
    branch: string,
    targetKey: string,
    by: LaunchedBy,
  ): Promise<TestInstanceOnBranch> {
    const initiative = await this.initiatives.activeInitiativeOnBranch(projectId, branch);
    return this.launch({ projectId, branch, targetKey, initiativeId: initiative?.id }, by);
  }

  /**
   * Every launch: refused, with every reason, unless the target is Hosted or Build to install
   * with its Secret variables typed and the limit has room; a Hosted one also needs the Project's
   * Run environment On and a free Proxy port. Answers the instance Building at once; the checkout
   * and the start or the build go on in the background, ending Running, Built or Failed.
   */
  private async launch(launch: LaunchRequest, by: LaunchedBy): Promise<TestInstanceOnBranch> {
    const target = await this.targets.launchOf(launch.projectId, launch.targetKey);
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
      const settings = await this.settings.read();
      const active = await this.repository.active();
      const over = overTheLimit(await this.namesOf(active), settings.testInstancesAtOnce);
      if (over !== undefined) throw new TestInstanceRefused([over]);
      const given = {
        id: randomUUID(),
        initiativeId: launch.initiativeId,
        projectId: launch.projectId,
        branch: launch.branch,
        targetKey: target.key,
        targetName: target.name,
        launchedBy: by,
        at: this.schedule.now(),
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
   * Stops a Building or Running instance: Stopped, or Failed for a Build to install one, saying how
   * it stopped; its port freed, its containers, volumes and checkout removed, the reason last in
   * its log. One that has ended already stays as it is.
   */
  async stop(id: string, reason: StopReason = BY_USER): Promise<TestInstanceOnBranch> {
    const instance = await this.read(id);
    if (!isActive(instance)) return instance;
    const held = this.held.get(id);
    held?.building.abort();
    const words = stopWords(reason);
    const change = await this.repository.update(id, (kept) =>
      stopped(kept, reason, this.schedule.now()),
    );
    if (!change?.event) return this.read(id);
    await this.files.note(id, words, held?.mask);
    await this.ended(change.instance, change.event);
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
   * ends Stopped and every one left Building Failed, saying The Office restarted; then the
   * runtime's Hosted instances and the checkouts left are removed. Logs stay.
   */
  async sweep(): Promise<void> {
    const at = this.schedule.now();
    for (const instance of await this.repository.active()) {
      const building = instance.state === "building";
      const change = await this.repository.update(instance.id, (kept) =>
        building ? failed(kept, RESTARTED_WHILE_BUILDING, at) : stopped(kept, BY_RESTART, at),
      );
      if (!change?.event) continue;
      await this.files.note(
        instance.id,
        building ? RESTARTED_WHILE_BUILDING : stopWords(BY_RESTART),
      );
      await this.events.publish(change.event);
    }
    await this.hostedServices.sweep();
    for (const checkout of await this.files.leftCheckouts()) {
      await this.targets.removeCheckout(checkout);
    }
  }

  /** Waits for the launches and stops going on in the background, for a test. */
  async settled(): Promise<void> {
    while (this.background.size > 0) await Promise.all(this.background);
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
    target: TargetLaunch,
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

  /** Building or Running → Failed, saying why in its log too, and what it holds removed. */
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
    // A build's compose project goes as its build ends, which a stop's abort ends.
    if (instance.kind === "hosted") {
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

  /** The Project's Hosted and Build to install targets; none while Test targets are off. */
  private async launchableTargetsOf(projectId: string): Promise<LaunchableTarget[]> {
    const [on, targets] = await Promise.all([
      this.targets.testTargetsOn(projectId),
      this.targets.targetsOf(projectId),
    ]);
    return on ? launchableOf(targets) : [];
  }

  /**
   * Each instance as the limit's refusal names it: by its target's name and its Initiative's, or
   * its branch's when it is linked to none.
   */
  private async namesOf(active: readonly TestInstance[]): Promise<ActiveInstanceName[]> {
    return Promise.all(
      active.map(async (instance) => {
        const { targetName, initiativeId } = instance;
        if (initiativeId === undefined) {
          return { targetName, branch: (await this.onBranch(instance)).branch };
        }
        const initiative = await this.initiatives.find(initiativeId);
        return { targetName, initiativeName: initiative?.name ?? "an Initiative" };
      }),
    );
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

/** The targets a test instance can be launched from: Hosted and Build to install. */
function launchableOf(
  targets: Awaited<ReturnType<ProjectTestTargets["targetsOf"]>>,
): LaunchableTarget[] {
  return targets.flatMap(({ key, name, kind, entryPoint }) =>
    kind === "hosted" || kind === "build-to-install" ? [{ key, name, kind, entryPoint }] : [],
  );
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
